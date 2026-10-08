import type { PlaySessionInput, SessionQuery } from '@retro-cloud/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { assertActiveDevice, type DevicePrincipal } from '../devices/service.js';
import { ApiError, notFound } from '../errors.js';

const fields = { id: true, deviceId: true, gameId: true, clientSessionId: true,
  startedAt: true, endedAt: true, durationSeconds: true } as const;
const conflict = () => new ApiError(409, 'SESSION_CONFLICT', 'Session identity or completed result differs');
export class SessionService {
  constructor(private readonly db: PrismaClient) {}
  async sync(principal: DevicePrincipal, input: PlaySessionInput) {
    const startedAt = new Date(input.startedAt);
    const endedAt = input.endedAt === null ? null : new Date(input.endedAt);
    const ceiling = Date.now() + 300000;
    if (startedAt.getTime() > ceiling || (endedAt && endedAt.getTime() > ceiling)) {
      throw new ApiError(400, 'SESSION_IN_FUTURE', 'Session exceeds allowed clock skew');
    }
    return this.db.$transaction(async tx => {
      // Serializes retries and key revocation on the same device.
      await assertActiveDevice(tx, principal);
      const device = await tx.device.findUniqueOrThrow({ where: { id: principal.deviceId } });
      const where = { deviceId_clientSessionId: { deviceId: device.id, clientSessionId: input.clientSessionId } };
      const existing = await tx.playSession.findUnique({ where, select: fields });
      if (existing) {
        if (existing.gameId !== input.gameId || existing.startedAt.getTime() !== startedAt.getTime()) throw conflict();
        if (existing.endedAt) {
          if (endedAt && (existing.endedAt.getTime() !== endedAt.getTime() || existing.durationSeconds !== input.durationSeconds)) throw conflict();
          return existing; // Delayed start messages must never reopen a completed session.
        }
        if (!endedAt) return existing;
        return tx.playSession.update({ where, data: { endedAt, durationSeconds: input.durationSeconds }, select: fields });
      }
      // Removed entries remain eligible for historical offline uploads.
      const entry = await tx.libraryEntry.findFirst({ where: { deviceId: device.id, gameFile: { gameId: input.gameId } } });
      if (!entry) throw notFound();
      return tx.playSession.create({ data: {
        deviceId: device.id, userId: device.userId, gameId: input.gameId,
        clientSessionId: input.clientSessionId, startedAt, endedAt, durationSeconds: input.durationSeconds,
      }, select: fields });
    });
  }
  private where(userId: string, query: SessionQuery): Prisma.PlaySessionWhereInput {
    return { userId, ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.gameId ? { gameId: query.gameId } : {}),
      ...(query.from || query.to ? { startedAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      } } : {}) };
  }
  async list(userId: string, query: SessionQuery) {
    const where = this.where(userId, query);
    const [items, total] = await this.db.$transaction([
      this.db.playSession.findMany({ where, select: fields,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], take: query.limit, skip: query.offset }),
      this.db.playSession.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }
  async stats(userId: string, query: SessionQuery) {
    const where = this.where(userId, query);
    const [totals, openSessions, groups] = await this.db.$transaction([
      this.db.playSession.aggregate({ where: { ...where, endedAt: { not: null } },
        _count: true, _sum: { durationSeconds: true }, _max: { startedAt: true } }),
      this.db.playSession.count({ where: { ...where, endedAt: null } }),
      this.db.playSession.groupBy({ by: ['gameId'], where: { ...where, endedAt: { not: null } },
        _count: true, _sum: { durationSeconds: true }, _max: { startedAt: true },
        orderBy: [{ _max: { startedAt: 'desc' } }, { gameId: 'asc' }], take: query.limit + 1, skip: query.offset }),
    ]);
    return { completedSessions: totals._count, openSessions,
      durationSeconds: totals._sum.durationSeconds ?? 0, lastPlayedAt: totals._max.startedAt,
      games: groups.slice(0, query.limit).map(group => ({ gameId: group.gameId,
        completedSessions: group._count, durationSeconds: group._sum?.durationSeconds ?? 0,
        lastPlayedAt: group._max?.startedAt ?? null })),
      hasMore: groups.length > query.limit, limit: query.limit, offset: query.offset };
  }
}
