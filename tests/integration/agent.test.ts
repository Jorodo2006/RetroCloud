import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
import { createDatabase } from '../../api/src/infrastructure.js';
import { createLogger } from '../../api/src/logger.js';
import { DeviceService } from '../../api/src/devices/service.js';
import { loadAgentConfig, libraryConfigSchema } from '../../agent/src/config.js';
import { scanLibrary } from '../../agent/src/scanner.js';
import { AgentState } from '../../agent/src/state.js';
import { ApiClient } from '../../agent/src/client.js';
import { flushQueue } from '../../agent/src/sync.js';

if (process.env.RETRO_TEST_ISOLATED !== '1' || !new URL(process.env.DATABASE_URL!).pathname.startsWith('/retro_test_')) {
  throw new Error('Agent integration requires the isolated test runner');
}
const config = loadConfig();
const db = createDatabase(config);
const devices = new DeviceService(db);
const userId = randomUUID();
let root = '', deviceId = '', apiKey = '', base = '';
let server: Server;
let state: AgentState | undefined;
let client: ApiClient;
const content = 'Synthetic bytes; not a ROM: ' + randomUUID();
const mapping = libraryConfigSchema.parse({ roots: [{ directory: 'snes', consoleSlug: 'snes', extensions: ['.sfc'] }] });
const app = createApp(createLogger('silent'), { database: async () => {}, storage: async () => {} },
  { database: db, config });
function agentConfig() {
  return loadAgentConfig({ AGENT_ROMS_ROOT: root, AGENT_STATE_ROOT: path.join(root, 'state') });
}
async function scan() {
  const result = await scanLibrary(agentConfig(), mapping, state);
  state!.recordScan(result.observations, result.items);
  return result;
}
async function listen(port = 0) {
  server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  base = 'http://127.0.0.1:' + address.port;
}
async function stopServer() {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'retro-agent-integration-'));
  await mkdir(path.join(root, 'snes'));
  await writeFile(path.join(root, 'snes', 'A.sfc'), content);
  await writeFile(path.join(root, 'snes', 'B.sfc'), content);
  await writeFile(path.join(root, 'library.json'), JSON.stringify(mapping));
  await db.user.create({ data: { id: userId, email: userId + '@fixture.invalid', displayName: 'Agent fixture', passwordHash: 'fixture-no-login' } });
  const registered = await devices.create(userId, 'Agent integration');
  deviceId = registered.device.id; apiKey = registered.apiKey;
  await listen();
  state = await AgentState.open(agentConfig().AGENT_STATE_ROOT, { apiUrl: base, deviceId });
  client = new ApiClient(base, apiKey, deviceId, 10000);
});
afterAll(async () => {
  await stopServer(); state?.close(); state = undefined;
  const entries = await db.libraryEntry.findMany({ where: { deviceId }, include: { gameFile: true } });
  const gameIds = entries.map(entry => entry.gameFile.gameId);
  await db.libraryEntry.deleteMany({ where: { deviceId } });
  await db.device.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.gameFile.deleteMany({ where: { gameId: { in: gameIds } } });
  await db.game.deleteMany({ where: { id: { in: gameIds } } });
  await db.$disconnect();
  if (root && path.dirname(path.resolve(root)) === path.resolve(tmpdir()) && path.basename(root).startsWith('retro-agent-integration-')) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('agent against the real HTTP API and MySQL', () => {
  it('recovers an accepted response lost in transit without duplicating the library', async () => {
    const result = await scan();
    expect(result.stats).toMatchObject({ files: 2, games: 1 });
    let lost = true;
    const request: typeof fetch = async (url, options) => {
      const body = String(options?.body);
      expect(body).not.toContain(content);
      expect(body).not.toContain(root.replaceAll('\\', '\\\\'));
      const response = await fetch(url, options);
      if (lost) { lost = false; await response.body?.cancel(); throw new Error('Simulated lost acknowledgement'); }
      return response;
    };
    client = new ApiClient(base, apiKey, deviceId, 10000, request);
    expect(await flushQueue(state!, client)).toMatchObject({ pending: 1, deferred: true });
    const first = await db.libraryEntry.findFirstOrThrow({ where: { deviceId } });
    state!.close(); state = await AgentState.open(agentConfig().AGENT_STATE_ROOT, { apiUrl: base, deviceId });
    state.retry();
    expect(await flushQueue(state, client)).toMatchObject({ pending: 0, synced: 1 });
    expect(await db.libraryEntry.count({ where: { deviceId } })).toBe(1);
    expect((await db.libraryEntry.findFirstOrThrow({ where: { deviceId } })).id).toBe(first.id);
    expect((await scan()).stats).toMatchObject({ cached: 2, hashed: 0 });
    expect(await readFile(path.join(root, 'snes', 'A.sfc'), 'utf8')).toBe(content);
  });
  it('queues while the server is offline and syncs after it returns', async () => {
    await writeFile(path.join(root, 'snes', 'C.sfc'), content + ' second game');
    await scan();
    const port = Number(new URL(base).port);
    await stopServer();
    expect(await flushQueue(state!, client)).toMatchObject({ pending: 1, deferred: true });
    await listen(port);
    state!.retry();
    expect(await flushQueue(state!, client)).toMatchObject({ pending: 0, synced: 2 });
    expect(await db.libraryEntry.count({ where: { deviceId } })).toBe(2);
  });
  it('retains metadata across key rotation and resumes with the replacement key', async () => {
    const rotated = await devices.rotate(userId, deviceId);
    await writeFile(path.join(root, 'snes', 'D.sfc'), content + ' third game');
    await scan();
    expect(await flushQueue(state!, client)).toMatchObject({ pending: 1, deferred: true });
    expect(state!.status().errors).toContainEqual({ code: 'HTTP_401', count: 1 });
    apiKey = rotated.apiKey;
    client = new ApiClient(base, apiKey, deviceId, 10000);
    state!.retry();
    expect(await flushQueue(state!, client)).toMatchObject({ pending: 0, synced: 3 });
  });
  it('runs the compiled CLI once and emits no device credentials', async () => {
    state!.close(); state = undefined;
    const child = spawn(process.execPath, ['agent/dist/main.js', 'once'], { env: {
      ...process.env, AGENT_API_URL: base, AGENT_API_KEY: apiKey, AGENT_DEVICE_ID: deviceId,
      AGENT_ROMS_ROOT: root, AGENT_STATE_ROOT: path.join(root, 'state'),
      AGENT_LIBRARY_CONFIG: path.join(root, 'library.json'), LOG_LEVEL: 'info',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const [code] = await once(child, 'close');
    expect(output).not.toContain(apiKey);
    expect(code, output).toBe(0);
    expect(output).toContain('Library scan committed');
    expect(await db.libraryEntry.count({ where: { deviceId } })).toBe(3);
  });
});
