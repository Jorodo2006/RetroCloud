import 'dotenv/config';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
import { createDatabase } from '../../api/src/infrastructure.js';
import { createLogger } from '../../api/src/logger.js';
import { hashToken } from '../../api/src/auth/crypto.js';

if (process.env.RETRO_TEST_ISOLATED !== '1' || !new URL(process.env.DATABASE_URL!).pathname.startsWith('/retro_test_')) {
  throw new Error('Run npm run test:integration: these fixtures require an isolated database');
}
const config = loadConfig();
const db = createDatabase(config);
const ok = async () => {};
const makeApp = (mode: 'first-user' | 'open' | 'closed' = 'open') => createApp(createLogger('silent'),
  { database: ok, storage: ok }, { database: db, config: { ...config, REGISTRATION_MODE: mode } });
const app = makeApp();
const password = 'integration password 123456';
const email = randomUUID() + '@example.invalid';
const headers = { 'X-Retro-Client': 'web', Origin: config.APP_ORIGIN };
const cookie = (res: Response) => {
  const values = res.headers['set-cookie'] as unknown as string[];
  return values[0]!.split(';')[0]!;
};
const register = (target: ReturnType<typeof makeApp>, address: string) =>
  request(target).post('/auth/register').set(headers).send({ email: address, password, displayName: 'Fixture' });
const login = () => request(app).post('/auth/login').set(headers).send({ email, password });
let token: string, otherToken: string, userId: string, otherUserId: string, key: string, deviceId: string, otherKey: string, otherDeviceId: string;
let registrationResults: Response[];
const fingerprint = () => ({ consoleSlug: 'snes', title: 'Synthetic game', hashAlgorithm: 'SHA256',
  checksum: createHash('sha256').update(randomBytes(32)).digest('hex'), sizeBytes: '4096' });
const sync = (apiKey: string, items: ReturnType<typeof fingerprint>[]) =>
  request(app).post('/agent/library').set('X-Api-Key', apiKey).send({ items });

beforeAll(async () => {
  // Only this fresh scratch database may reset its registration mutex.
  expect(await db.user.count()).toBe(0);
  await db.registrationGate.update({ where: { id: 1 }, data: { claimed: false } });
  const first = makeApp('first-user');
  registrationResults = await Promise.all([register(first, email), register(first, email)]);
  const created = registrationResults.find(result => result.status === 201)!;
  expect(created).toBeDefined();
  userId = created.body.user.id; token = created.body.accessToken;
  const other = await register(app, randomUUID() + '@example.invalid');
  expect(other.status).toBe(201);
  otherToken = other.body.accessToken; otherUserId = other.body.user.id;
  const a = await request(app).post('/devices').auth(token, { type: 'bearer' }).send({ name: 'Windows A' });
  const b = await request(app).post('/devices').auth(otherToken, { type: 'bearer' }).send({ name: 'Windows B' });
  expect(a.status).toBe(201); expect(b.status).toBe(201);
  key = a.body.apiKey; deviceId = a.body.device.id;
  otherKey = b.body.apiKey; otherDeviceId = b.body.device.id;
});
afterAll(async () => { await db.$disconnect(); }); // The runner drops the entire scratch database.

describe('local authentication', () => {
  it('allows only one first account under concurrent registration', () => {
    expect(registrationResults.map(result => result.status).sort()).toEqual([201, 403]);
  });
  it('keeps first-user and closed registration locked', async () => {
    expect((await register(makeApp('first-user'), randomUUID() + '@example.invalid')).status).toBe(403);
    expect((await register(makeApp('closed'), randomUUID() + '@example.invalid')).status).toBe(403);
  });
  it('returns a safe profile and stores only credential hashes', async () => {
    const response = await request(app).get('/auth/me').auth(token, { type: 'bearer' });
    expect(response.status).toBe(200); expect(response.body.user.id).toBe(userId);
    expect(JSON.stringify(response.body)).not.toContain('password');
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.passwordHash).not.toBe(password);
    const saved = await db.deviceApiKey.findUniqueOrThrow({ where: { keyHash: hashToken(key) } });
    expect(saved.keyHash).not.toBe(key);
    const devices = await request(app).get('/devices').auth(token, { type: 'bearer' });
    expect(devices.body.items.map((d: { id: string }) => d.id)).toEqual([deviceId]);
    expect(JSON.stringify(devices.body)).not.toContain('apiKey');
    expect(JSON.stringify(devices.body)).not.toContain('keyHash');
  });
  it('rejects wrong passwords and missing/misplaced credentials', async () => {
    expect((await request(app).post('/auth/login').set(headers).send({ email, password: 'incorrect' })).status).toBe(401);
    expect((await request(app).get('/auth/me')).status).toBe(401);
    expect((await request(app).get('/devices').set('X-Api-Key', key)).status).toBe(401);
    expect((await request(app).post('/agent/library').auth(token, { type: 'bearer' }).send({ items: [fingerprint()] })).status).toBe(401);
  });
  it('requires the browser client header and rejects foreign origins', async () => {
    expect((await request(app).post('/auth/login').send({ email, password })).status).toBe(403);
    expect((await request(app).post('/auth/refresh').set('X-Retro-Client', 'web').set('Origin', 'https://evil.invalid').send({})).status).toBe(403);
    expect((await request(app).post('/auth/logout').set('X-Retro-Client', 'web').set('Origin', 'null').send({})).status).toBe(403);
  });
  it('rotates refresh cookies and revokes the whole session on reuse', async () => {
    const signed = await login();
    expect(signed.status).toBe(200);
    expect(signed.body.refreshToken).toBeUndefined();
    expect(signed.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(signed.headers['set-cookie']?.[0]).toContain('SameSite=Strict');
    const refreshed = await request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(signed)).send({});
    expect(refreshed.status).toBe(200); expect(cookie(refreshed)).not.toBe(cookie(signed));
    expect((await request(app).get('/auth/me').auth(refreshed.body.accessToken, { type: 'bearer' })).status).toBe(200);
    expect((await request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(signed)).send({})).status).toBe(401);
    expect((await request(app).get('/auth/me').auth(refreshed.body.accessToken, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(refreshed)).send({})).status).toBe(401);
  });
  it('serializes simultaneous refresh attempts and detects reuse', async () => {
    const signed = await login();
    const pair = await Promise.all([1, 2].map(() =>
      request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(signed)).send({})));
    expect(pair.map(r => r.status).sort()).toEqual([200, 401]);
    const successful = pair.find(r => r.status === 200)!;
    expect((await request(app).get('/auth/me').auth(successful.body.accessToken, { type: 'bearer' })).status).toBe(401);
  });
  it('logout invalidates JWT and refresh immediately and can be repeated', async () => {
    const signed = await login();
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/auth/logout').set(headers).set('Cookie', cookie(signed)).send({})).status).toBe(204);
    }
    expect((await request(app).get('/auth/me').auth(signed.body.accessToken, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(signed)).send({})).status).toBe(401);
  });
  it('expired sessions cannot use JWT or refresh', async () => {
    const signed = await login();
    const refresh = await db.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie(signed).split('=')[1]!) } });
    await db.authSession.update({ where: { id: refresh.sessionId }, data: { expiresAt: new Date(0) } });
    expect((await request(app).get('/auth/me').auth(signed.body.accessToken, { type: 'bearer' })).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set(headers).set('Cookie', cookie(signed)).send({})).status).toBe(401);
  });
  it('limits repeated credential attempts with a consistent error', async () => {
    const limited = makeApp();
    let result: Response | undefined;
    for (let i = 0; i < 21; i++) result = await request(limited).post('/auth/login').set(headers).send({});
    expect(result?.status).toBe(429); expect(result?.body.error.code).toBe('RATE_LIMITED');
    expect(result?.headers['retry-after']).toBeTruthy();
  });
});

describe('library metadata and device authorization', () => {
  it('lists consoles and upserts repeated metadata without duplicates', async () => {
    expect((await request(app).get('/consoles').auth(token, { type: 'bearer' })).body.items.some((c: { slug: string }) => c.slug === 'snes')).toBe(true);
    const item = fingerprint();
    const a = await sync(key, [item, item]); const b = await sync(key, [item]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.items).toHaveLength(1); expect(a.body.items[0].id).toBe(b.body.items[0].id);
    expect(a.body.items[0].file.sizeBytes).toBe('4096');
    expect(await db.gameFile.count({ where: { checksum: item.checksum } })).toBe(1);
  });
  it('isolates users even when they own identical game bytes', async () => {
    const item = fingerprint();
    const a = await sync(key, [{ ...item, title: 'Private A title' }]);
    const b = await sync(otherKey, [{ ...item, title: 'Private B title' }]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.items[0].gameId).toBe(b.body.items[0].gameId);
    const visible = await request(app).get('/library/' + a.body.items[0].id).auth(token, { type: 'bearer' });
    expect(visible.body.title).toBe('Private A title');
    expect((await request(app).get('/library/' + a.body.items[0].id).auth(otherToken, { type: 'bearer' })).status).toBe(404);
    const filtered = await request(app).get('/library').query({ deviceId, consoleSlug: 'snes', limit: 1 }).auth(otherToken, { type: 'bearer' });
    expect(filtered.status).toBe(200); expect(filtered.body.total).toBe(0);
    expect((await request(app).delete('/agent/library/' + a.body.items[0].id).set('X-Api-Key', otherKey)).status).toBe(404);
  });
  it('serializes repeated sync and rolls back cross-device fingerprint races', async () => {
    const item = fingerprint();
    const results = await Promise.all([sync(key, [item]), sync(key, [item]), sync(otherKey, [item])]);
    expect(results.map(r => r.status)).toEqual([200, 200, 200]);
    expect(await db.gameFile.count({ where: { checksum: item.checksum } })).toBe(1);
    expect(await db.libraryEntry.count({ where: { gameFile: { checksum: item.checksum } } })).toBe(2);
  });
  it('rejects a console conflict atomically, including earlier entries in the batch', async () => {
    const item = fingerprint(); await sync(key, [item]);
    const fresh = { ...fingerprint(), checksum: '0'.repeat(64) };
    const conflict = await sync(otherKey, [fresh, { ...item, consoleSlug: 'nes' }]);
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe('FINGERPRINT_CONFLICT');
    expect(await db.gameFile.count({ where: { checksum: fresh.checksum } })).toBe(0);
  });
  it('rejects ROM payloads, unknown fields/consoles and invalid pagination', async () => {
    expect((await request(app).post('/agent/library').set('X-Api-Key', key).send({ items: [{ ...fingerprint(), rom: 'data' }] })).status).toBe(400);
    expect((await sync(key, [{ ...fingerprint(), consoleSlug: 'unknown-console' }])).status).toBe(400);
    expect((await request(app).get('/library').query({ limit: '-1' }).auth(token, { type: 'bearer' })).status).toBe(400);
    expect((await request(app).get('/library').query({ userId: otherUserId }).auth(token, { type: 'bearer' })).status).toBe(400);
  });
  it('soft deletes idempotently and reactivates the same entry on rescan', async () => {
    const item = fingerprint(); const first = await sync(key, [item]); const id = first.body.items[0].id;
    for (let i = 0; i < 2; i++) expect((await request(app).delete('/agent/library/' + id).set('X-Api-Key', key)).status).toBe(204);
    expect((await request(app).get('/library/' + id).auth(token, { type: 'bearer' })).status).toBe(404);
    const restored = await sync(key, [item]);
    expect(restored.body.items[0].id).toBe(id);
    expect(restored.body.items[0].firstSeenAt).toBe(first.body.items[0].firstSeenAt);
  });
  it('prevents managing another user device and invalidates rotated/revoked keys', async () => {
    expect((await request(app).delete('/devices/' + deviceId).auth(otherToken, { type: 'bearer' })).status).toBe(404);
    expect((await request(app).post('/devices/' + deviceId + '/key').auth(otherToken, { type: 'bearer' }).send({})).status).toBe(404);
    const rotated = await request(app).post('/devices/' + deviceId + '/key').auth(token, { type: 'bearer' }).send({});
    expect(rotated.status).toBe(200);
    expect((await sync(key, [fingerprint()])).status).toBe(401);
    key = rotated.body.apiKey;
    expect((await sync(key, [fingerprint()])).status).toBe(200);
    expect((await request(app).delete('/devices/' + deviceId).auth(token, { type: 'bearer' })).status).toBe(204);
    expect((await sync(key, [fingerprint()])).status).toBe(401);
    expect((await request(app).post('/devices/' + deviceId + '/key').auth(token, { type: 'bearer' }).send({})).status).toBe(409);
    const history = await request(app).get('/library').query({ deviceId }).auth(token, { type: 'bearer' });
    expect(history.body.total).toBeGreaterThan(0);
    expect((await db.device.findUniqueOrThrow({ where: { id: otherDeviceId } })).revokedAt).toBeNull();
  });
});
