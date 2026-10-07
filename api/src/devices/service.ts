import type { RequestHandler } from 'express';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { hashToken, newToken } from '../auth/crypto.js';
import { ApiError, notFound, unauthorized } from '../errors.js';

const deviceFields = { id: true, name: true, createdAt: true, lastSeenAt: true, revokedAt: true } as const;
export interface DevicePrincipal { deviceId: string; keyId: string }
export async function assertActiveDevice(tx: Prisma.TransactionClient, principal: DevicePrincipal) {
  await tx.$queryRaw`SELECT id FROM devices WHERE id = ${principal.deviceId} FOR UPDATE`;
  const key = await tx.deviceApiKey.findFirst({ where: {
    id: principal.keyId, deviceId: principal.deviceId, revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], device: { revokedAt: null },
  } });
  if (!key) throw unauthorized();
}
export class DeviceService {
  constructor(private readonly db: PrismaClient) {}
  private key() {
    const raw = 'rcd_' + newToken();
    return { raw, data: { keyHash: hashToken(raw), keyPrefix: raw.slice(0, 12) } };
  }
  async create(userId: string, name: string) {
    const key = this.key();
    const device = await this.db.device.create({ data: {
      userId, name, keys: { create: key.data },
    }, select: deviceFields });
    return { device, apiKey: key.raw, keyPrefix: key.data.keyPrefix };
  }
  async list(userId: string, limit: number, offset: number) {
    const [items, total] = await this.db.$transaction([
      this.db.device.findMany({ where: { userId }, select: deviceFields,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: offset }),
      this.db.device.count({ where: { userId } }),
    ]);
    return { items, total, limit, offset };
  }
  private async own(tx: Prisma.TransactionClient, userId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM devices WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
    const device = await tx.device.findFirst({ where: { id, userId } });
    if (!device) throw notFound();
    return device;
  }
  async rotate(userId: string, id: string) {
    const key = this.key();
    await this.db.$transaction(async tx => {
      const device = await this.own(tx, userId, id);
      if (device.revokedAt) throw new ApiError(409, 'DEVICE_REVOKED', 'Device has been revoked');
      await tx.deviceApiKey.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.deviceApiKey.create({ data: { deviceId: id, ...key.data } });
    });
    return { apiKey: key.raw, keyPrefix: key.data.keyPrefix };
  }
  async revoke(userId: string, id: string) {
    await this.db.$transaction(async tx => {
      const device = await this.own(tx, userId, id);
      if (device.revokedAt) return;
      const revokedAt = new Date();
      await tx.device.update({ where: { id }, data: { revokedAt } });
      await tx.deviceApiKey.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt } });
    });
  }
  async authenticate(raw: string | undefined): Promise<DevicePrincipal> {
    if (!raw || !/^rcd_[A-Za-z0-9_-]{43}$/.test(raw)) throw unauthorized();
    const key = await this.db.deviceApiKey.findUnique({ where: { keyHash: hashToken(raw) }, include: { device: true } });
    if (!key || key.revokedAt || key.device.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) throw unauthorized();
    return { deviceId: key.deviceId, keyId: key.id };
  }
  middleware(): RequestHandler {
    return async (req, res, next) => {
      res.locals.device = await this.authenticate(req.get('X-Api-Key'));
      next();
    };
  }
}
