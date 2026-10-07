import request from 'supertest';
import { createApp } from '../../api/src/app.js';
import { createLogger } from '../../api/src/logger.js';
import { createStorageKey } from '../../api/src/local-storage.js';
import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../api/src/config.js';
import { createDatabase, createStorage } from '../../api/src/infrastructure.js';

const config = loadConfig();
const db = createDatabase(config);
const ids = {
  user: randomUUID(), otherUser: randomUUID(), device: randomUUID(), otherDevice: randomUUID(),
  console: randomUUID(), game: randomUUID(), file: randomUUID(), save: randomUUID(), otherSave: randomUUID(),
};
const checksum = createHash('sha256').update(ids.file).digest('hex');
const fixtureVersionIds: string[] = [];

beforeAll(async () => {
  await db.user.createMany({ data: [ids.user, ids.otherUser].map(id => ({
    id, email: id + '@integration.invalid', passwordHash: 'test-only-no-login', displayName: 'Integration fixture',
  })) });
  await db.device.createMany({ data: [
    { id: ids.device, userId: ids.user, name: 'fixture' },
    { id: ids.otherDevice, userId: ids.otherUser, name: 'other fixture' },
  ] });
  await db.console.create({ data: { id: ids.console, slug: 'test-' + ids.console, name: 'Integration console' } });
  await db.game.create({ data: { id: ids.game, consoleId: ids.console, title: 'Integration fixture' } });
  await db.gameFile.create({ data: { id: ids.file, gameId: ids.game, hashAlgorithm: 'SHA256', checksum, sizeBytes: 128n } });
  await db.saveFile.createMany({ data: [ids.save, ids.otherSave].map(id => ({
    id, userId: ids.user, gameId: ids.game, kind: 'SRAM', slot: id, formatKey: 'integration-v1',
  })) });
});

afterAll(async () => {
  // Delete only fixtures owned by this test run, in reverse dependency order.
  for (const id of fixtureVersionIds.reverse()) await db.saveVersion.deleteMany({ where: { id } });
  await db.saveFile.deleteMany({ where: { id: { in: [ids.save, ids.otherSave] } } });
  await db.playSession.deleteMany({ where: { deviceId: { in: [ids.device, ids.otherDevice] } } });
  await db.libraryEntry.deleteMany({ where: { deviceId: { in: [ids.device, ids.otherDevice] } } });
  await db.gameFile.deleteMany({ where: { gameId: ids.game } });
  await db.game.deleteMany({ where: { id: ids.game } });
  await db.console.deleteMany({ where: { id: ids.console } });
  await db.device.deleteMany({ where: { id: { in: [ids.device, ids.otherDevice] } } });
  await db.user.deleteMany({ where: { id: { in: [ids.user, ids.otherUser] } } });
  await db.$disconnect();
});

function versionData(version: number) {
  const id = randomUUID();
  // Record attempted inserts too, so unexpected successes are still cleaned up.
  fixtureVersionIds.push(id);
  return {
    id, version, saveFileId: ids.save, userId: ids.user, deviceId: ids.device,
    clientOperationId: randomUUID(), storageKey: 'integration/' + id, checksum, sizeBytes: 128n, capturedAt: new Date(),
  };
}

describe('MySQL constraints on the migrated schema', () => {
  it('rejects duplicate file fingerprints and library entries', async () => {
    await expect(db.gameFile.create({ data: {
      gameId: ids.game, hashAlgorithm: 'SHA256', checksum, sizeBytes: 128n,
    } })).rejects.toMatchObject({ code: 'P2002' });
    const data = { deviceId: ids.device, gameFileId: ids.file };
    await db.libraryEntry.create({ data });
    await expect(db.libraryEntry.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces idempotent session identifiers and device ownership', async () => {
    const data = { userId: ids.user, deviceId: ids.device, gameId: ids.game, clientSessionId: randomUUID(), startedAt: new Date() };
    await db.playSession.create({ data });
    await expect(db.playSession.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.playSession.create({ data: { ...data, clientSessionId: randomUUID(), userId: ids.otherUser } }))
      .rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects sessions that end before they start', async () => {
    await expect(db.playSession.create({ data: {
      userId: ids.user, deviceId: ids.device, gameId: ids.game, clientSessionId: randomUUID(),
      startedAt: new Date('2026-10-07T12:00:00Z'), endedAt: new Date('2026-10-07T11:00:00Z'), durationSeconds: 1,
    } })).rejects.toThrow();
  });

  it('allows separate save branches but rejects duplicate operations and unrelated parents', async () => {
    const baseData = versionData(1);
    const base = await db.saveVersion.create({ data: baseData });
    await db.saveVersion.create({ data: { ...versionData(2), parentVersionId: base.id } });
    await db.saveVersion.create({ data: { ...versionData(3), parentVersionId: base.id } });
    await expect(db.saveVersion.create({ data: {
      ...versionData(4), clientOperationId: baseData.clientOperationId,
    } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.saveVersion.create({ data: versionData(2) })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.saveVersion.create({ data: {
      ...versionData(1), saveFileId: ids.otherSave, parentVersionId: base.id,
    } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects another user device as a save source', async () => {
    await expect(db.saveVersion.create({ data: { ...versionData(8), deviceId: ids.otherDevice } }))
      .rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects version zero and malformed SHA256 values', async () => {
    await expect(db.saveVersion.create({ data: versionData(0) })).rejects.toThrow();
    await expect(db.saveVersion.create({ data: { ...versionData(9), checksum: 'z'.repeat(64) } })).rejects.toThrow();
  });
});


describe('local private storage', () => {
  it('persists a synthetic save and exposes no static download route', async () => {
    const storage = createStorage(config);
    await storage.initialize();
    const key = createStorageKey('saves');
    const data = Buffer.from('synthetic save fixture; not a ROM');
    try {
      await storage.put(key, data);
      expect(await createStorage(config).read(key)).toEqual(data);
      const response = await request(createApp(createLogger('silent'), {
        database: async () => {}, storage: () => storage.check(),
      })).get('/' + key);
      expect(response.status).toBe(404);
    } finally {
      await storage.remove(key);
    }
  });
});
