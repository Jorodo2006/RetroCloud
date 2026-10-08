import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
import { createDatabase } from '../../api/src/infrastructure.js';
import { createLogger } from '../../api/src/logger.js';
import { DeviceService } from '../../api/src/devices/service.js';
import { AccessTokens } from '../../api/src/auth/crypto.js';
if (process.env.RETRO_TEST_ISOLATED !== '1' || !new URL(process.env.DATABASE_URL!).pathname.startsWith('/retro_test_')) {
  throw new Error('Session fixtures require the isolated test runner');
}
const config = loadConfig(), db = createDatabase(config);
const devices = new DeviceService(db);
const app = createApp(createLogger('silent'), { database: async () => {}, storage: async () => {} }, { database: db, config });
const userIds = [randomUUID(), randomUUID()];
let key = '', otherKey = '', token = '', otherToken = '', deviceId = '', gameId = '';
const start = '2026-01-01T00:00:00.000Z', end = '2026-01-01T00:01:00.000Z';
const input = () => ({ clientSessionId: randomUUID(), gameId, startedAt: start });
const send = (body: object, apiKey = key) => request(app).post('/agent/sessions').set('X-Api-Key', apiKey).send(body);
beforeAll(async () => {
  const keys: string[] = [], tokens: string[] = [];
  for (const id of userIds) {
    await db.user.create({ data: { id, email: id + '@fixture.invalid', displayName: 'Session fixture', passwordHash: 'no-login' } });
    const session = await db.authSession.create({ data: { userId: id, expiresAt: new Date(Date.now() + 3600000) } });
    tokens.push(await new AccessTokens(config.JWT_SECRET).issue(id, session.id));
    const device = await devices.create(id, 'Session fixture');
    keys.push(device.apiKey);
    if (id === userIds[0]) deviceId = device.device.id;
  }
  [key, otherKey] = [keys[0]!, keys[1]!]; [token, otherToken] = [tokens[0]!, tokens[1]!];
  const response = await request(app).post('/agent/library').set('X-Api-Key', key).send({ items: [{
    consoleSlug: 'snes', title: 'Simulated sessions', hashAlgorithm: 'SHA256',
    checksum: createHash('sha256').update(randomUUID()).digest('hex'), sizeBytes: '100',
  }] });
  expect(response.status).toBe(200); gameId = response.body.items[0].gameId;
});
afterAll(async () => {
  await db.playSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.libraryEntry.deleteMany({ where: { device: { userId: { in: userIds } } } });
  await db.device.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  if (gameId) {
    await db.gameFile.deleteMany({ where: { gameId } });
    await db.game.delete({ where: { id: gameId } });
  }
  await db.$disconnect();
});
describe('session API with MySQL', () => {
  it('requires the appropriate authentication and library ownership', async () => {
    expect((await request(app).post('/agent/sessions').send(input())).status).toBe(401);
    expect((await send(input(), otherKey)).status).toBe(404);
    expect((await request(app).get('/sessions')).status).toBe(401);
    expect((await request(app).get('/stats').set('X-Api-Key', key)).status).toBe(401);
  });
  it('closes once and tolerates retransmitted or delayed starts', async () => {
    const body = input();
    const a = await send(body); expect(a.status).toBe(200);
    const closed = { ...body, endedAt: end, durationSeconds: 45 };
    const b = await send(closed); expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await send(closed)).body).toEqual(b.body);
    expect((await send(body)).body).toEqual(b.body);
    expect(await db.playSession.count({ where: { deviceId, clientSessionId: body.clientSessionId } })).toBe(1);
  });
  it('accepts completed offline sessions before their start messages', async () => {
    const body = input();
    const result = await send({ ...body, endedAt: end, durationSeconds: 60 });
    expect(result.status).toBe(200);
    expect((await send(body)).body.endedAt).toBe(end);
  });
  it('serializes concurrent duplicate uploads', async () => {
    const body = { ...input(), endedAt: end, durationSeconds: 60 };
    const results = await Promise.all([send(body), send(body), send(body)]);
    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map(r => r.body.id)).size).toBe(1);
  });
  it('keeps only one result when different closures race', async () => {
    const body = input();
    expect((await send(body)).status).toBe(200);
    const results = await Promise.all([
      send({ ...body, endedAt: end, durationSeconds: 40 }),
      send({ ...body, endedAt: end, durationSeconds: 50 }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const saved = await db.playSession.findUniqueOrThrow({ where: {
      deviceId_clientSessionId: { deviceId, clientSessionId: body.clientSessionId },
    } });
    expect(saved.durationSeconds).toBe(results.find(r => r.status === 200)!.body.durationSeconds);
  });
  it('rejects conflicting identities or completed results', async () => {
    const body = { ...input(), endedAt: end, durationSeconds: 60 };
    expect((await send(body)).status).toBe(200);
    for (const change of [{ gameId: randomUUID() }, { startedAt: '2026-01-01T00:00:01.000Z', durationSeconds: 59 }, { durationSeconds: 59 }]) {
      const response = await send({ ...body, ...change });
      expect(response.status).toBe(409); expect(response.body.error.code).toBe('SESSION_CONFLICT');
    }
  });
  it('rejects invalid intervals, client ownership fields and future timestamps', async () => {
    expect((await send({ ...input(), endedAt: end, durationSeconds: 61 })).status).toBe(400);
    expect((await send({ ...input(), userId: userIds[1] })).status).toBe(400);
    expect((await send({ ...input(), startedAt: '2099-01-01T00:00:00.000Z' })).body.error.code).toBe('SESSION_IN_FUTURE');
  });
  it('filters history and aggregates closed sessions without counting open time', async () => {
    const startedAt = '2001-01-01T00:00:00.000Z', endedAt = '2001-01-01T00:02:00.000Z';
    expect((await send({ ...input(), startedAt, endedAt, durationSeconds: 90 })).status).toBe(200);
    expect((await send({ ...input(), startedAt })).status).toBe(200);
    const query = { from: startedAt, to: '2001-01-02T00:00:00.000Z', deviceId, gameId, limit: 1 };
    const stats = await request(app).get('/stats').auth(token, { type: 'bearer' }).query(query);
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ completedSessions: 1, openSessions: 1, durationSeconds: 90,
      games: [{ gameId, completedSessions: 1, durationSeconds: 90 }], hasMore: false });
    const history = await request(app).get('/sessions').auth(token, { type: 'bearer' }).query(query);
    expect(history.body.total).toBe(2); expect(history.body.items).toHaveLength(1);
    const other = await request(app).get('/stats').auth(otherToken, { type: 'bearer' }).query(query);
    expect(other.body).toMatchObject({ completedSessions: 0, openSessions: 0, durationSeconds: 0, games: [] });
    expect((await request(app).get('/sessions').auth(otherToken, { type: 'bearer' }).query(query)).body.total).toBe(0);
    expect((await request(app).get('/sessions').auth(token, { type: 'bearer' }).query({ from: endedAt, to: startedAt })).status).toBe(400);
  });
  it('allows historical uploads after library removal, but rejects revoked keys', async () => {
    await db.libraryEntry.updateMany({ where: { deviceId }, data: { removedAt: new Date() } });
    expect((await send({ ...input(), endedAt: end, durationSeconds: 0 })).status).toBe(200);
    await devices.revoke(userIds[0]!, deviceId);
    expect((await send(input())).status).toBe(401);
  });
});
