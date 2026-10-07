import type { LibraryQuery, LibrarySync } from '@retro-cloud/shared';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { assertActiveDevice } from '../devices/service.js';
import type { DevicePrincipal } from '../devices/service.js';
import { ApiError, hasCode, notFound } from '../errors.js';

const include = { device: { select: { id: true, name: true, revokedAt: true } },
  gameFile: { include: { game: { include: { console: true } } } } } as const;
type Entry = Prisma.LibraryEntryGetPayload<{ include: typeof include }>;
function present(entry: Entry) {
  const { gameFile: file } = entry;
  return {
    id: entry.id, device: entry.device, gameId: file.gameId,
    title: entry.displayTitle ?? file.game.title,
    console: { id: file.game.console.id, slug: file.game.console.slug, name: file.game.console.name },
    file: { id: file.id, hashAlgorithm: file.hashAlgorithm, checksum: file.checksum, sizeBytes: file.sizeBytes.toString() },
    firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt,
  };
}
export class LibraryService {
  constructor(private readonly db: PrismaClient) {}
  async consoles() {
    return { items: await this.db.console.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } }) };
  }
  async list(userId: string, query: LibraryQuery) {
    const where: Prisma.LibraryEntryWhereInput = {
      device: { userId }, removedAt: null,
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.consoleSlug ? { gameFile: { game: { console: { slug: query.consoleSlug } } } } : {}),
    };
    const [entries, total] = await this.db.$transaction([
      this.db.libraryEntry.findMany({ where, include, orderBy: { id: 'asc' }, take: query.limit, skip: query.offset }),
      this.db.libraryEntry.count({ where }),
    ]);
    return { items: entries.map(present), total, limit: query.limit, offset: query.offset };
  }
  async get(userId: string, id: string) {
    const entry = await this.db.libraryEntry.findFirst({ where: { id, device: { userId }, removedAt: null }, include });
    if (!entry) throw notFound();
    return present(entry);
  }
  async sync(principal: DevicePrincipal, input: LibrarySync) {
    // A uniqueness race on a shared fingerprint rolls back the entire batch, then retries.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          await assertActiveDevice(tx, principal);
          const entries: Entry[] = [];
          const now = new Date();
          // Stable ordering reduces deadlocks between batches from different devices.
          const ordered = [...input.items].sort((a, b) => a.checksum.localeCompare(b.checksum) || a.sizeBytes.localeCompare(b.sizeBytes));
          for (const item of ordered) {
            const console = await tx.console.findUnique({ where: { slug: item.consoleSlug } });
            if (!console) throw new ApiError(400, 'UNKNOWN_CONSOLE', 'Console is not in the catalog');
            const fingerprint = { hashAlgorithm: item.hashAlgorithm, checksum: item.checksum, sizeBytes: BigInt(item.sizeBytes) };
            let file = await tx.gameFile.findUnique({ where: { hashAlgorithm_checksum_sizeBytes: fingerprint }, include: { game: true } });
            if (file && file.game.consoleId !== console.id) {
              throw new ApiError(409, 'FINGERPRINT_CONFLICT', 'Fingerprint belongs to another console');
            }
            if (!file) file = await tx.gameFile.create({ data: {
              ...fingerprint, game: { create: { consoleId: console.id, title: 'Unidentified game' } },
            }, include: { game: true } });
            const entry = await tx.libraryEntry.upsert({
              where: { deviceId_gameFileId: { deviceId: principal.deviceId, gameFileId: file.id } },
              create: { deviceId: principal.deviceId, gameFileId: file.id, displayTitle: item.title, lastSeenAt: now },
              update: { removedAt: null, lastSeenAt: now, displayTitle: item.title }, include,
            });
            entries.push(entry);
          }
          await tx.device.update({ where: { id: principal.deviceId }, data: { lastSeenAt: now } });
          return { items: [...new Map(entries.map(entry => [entry.id, present(entry)])).values()] };
        }, { timeout: 15000 });
      } catch (error) {
        if (attempt < 2 && (hasCode(error, 'P2002') || hasCode(error, 'P2034'))) continue;
        throw error;
      }
    }
  }
  async remove(principal: DevicePrincipal, id: string) {
    await this.db.$transaction(async tx => {
      await assertActiveDevice(tx, principal);
      const entry = await tx.libraryEntry.findFirst({ where: { id, deviceId: principal.deviceId } });
      if (!entry) throw notFound();
      if (!entry.removedAt) await tx.libraryEntry.update({ where: { id }, data: { removedAt: new Date() } });
    });
  }
}
