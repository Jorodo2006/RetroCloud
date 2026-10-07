import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentConfig, libraryConfigSchema, credentials } from '../../agent/src/config.js';
import { digestReader, hashFile } from '../../agent/src/hash.js';
import { scanLibrary } from '../../agent/src/scanner.js';
import { AgentState } from '../../agent/src/state.js';

let root = '';
let state: AgentState | undefined;
const deviceId = randomUUID();
const binding = { apiUrl: 'http://localhost:3000', deviceId };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'retro-agent-unit-'));
  await mkdir(path.join(root, 'snes'));
});
afterEach(async () => {
  state?.close(); state = undefined;
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('retro-agent-unit-')) throw new Error('Unsafe test cleanup');
  await rm(root, { recursive: true, force: true });
});
const config = () => loadAgentConfig({ AGENT_ROMS_ROOT: root, AGENT_STATE_ROOT: path.join(root, 'state') });
const mapping = () => libraryConfigSchema.parse({ roots: [{ directory: 'snes', consoleSlug: 'snes', extensions: ['.sfc'] }] });

describe('agent configuration and file identification', () => {
  it('allows offline inspection without credentials but requires them to sync', () => {
    expect(() => credentials(config())).toThrow('AGENT_CREDENTIALS_REQUIRED');
    expect(() => loadAgentConfig({ AGENT_API_URL: 'https://key:secret@server.invalid' })).toThrow('AGENT_CONFIG_INVALID');
    expect(() => loadAgentConfig({ AGENT_API_URL: 'http://localhost/api?secret=value' })).toThrow('AGENT_CONFIG_INVALID');
  });
  it.each(['../roms', '/roms', 'C:\\roms', 'snes/../nes', '.', 'snes\\..\\nes'])('rejects escaping directory %s', directory => {
    expect(libraryConfigSchema.safeParse({ roots: [{ directory, consoleSlug: 'snes', extensions: ['.sfc'] }] }).success).toBe(false);
  });
  it('hashes known bytes and large files without changing their content', async () => {
    const file = path.join(root, 'snes', 'fixture.sfc');
    await writeFile(file, 'abc');
    expect(await hashFile(file)).toMatchObject({ checksum: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sizeBytes: '3' });
    const large = Buffer.alloc(2 * 1024 * 1024 + 19, 27);
    await writeFile(file, large);
    expect(await hashFile(file)).toMatchObject({ checksum: createHash('sha256').update(large).digest('hex'), sizeBytes: String(large.length) });
    expect((await lstat(file)).size).toBe(large.length);
  });
  it('rejects a file changed during hashing and a short read', async () => {
    const file = path.join(root, 'snes', 'fixture.sfc'); await writeFile(file, 'abc');
    const stat = await lstat(file, { bigint: true });
    let reads = 0;
    const changed = Object.assign(Object.create(stat) as typeof stat, { mtimeNs: stat.mtimeNs + 1n });
    await expect(digestReader({
      stat: async () => reads ? changed : stat,
      read: async buffer => { reads++; buffer.write('abc'); return 3; },
    })).rejects.toThrow('SCAN_FILE_CHANGED');
    await expect(digestReader({ stat: async () => stat, read: async () => 0 })).rejects.toThrow('SCAN_FILE_CHANGED');
  });
  it('supports cancellation and rejects empty files', async () => {
    const file = path.join(root, 'snes', 'fixture.sfc');
    await writeFile(file, 'abc');
    await expect(hashFile(file, AbortSignal.abort())).rejects.toThrow();
    await writeFile(file, '');
    await expect(hashFile(file)).rejects.toThrow('SCAN_INVALID_FILE');
  });
  it('filters extensions, walks folders, deduplicates and caches unchanged files', async () => {
    await mkdir(path.join(root, 'snes', 'sub'));
    await writeFile(path.join(root, 'snes', 'Alpha.sfc'), 'same bytes');
    await writeFile(path.join(root, 'snes', 'sub', 'Duplicate.SFC'), 'same bytes');
    await writeFile(path.join(root, 'snes', 'ignore.txt'), 'ignored');
    state = await AgentState.open(config().AGENT_STATE_ROOT, binding);
    const first = await scanLibrary(config(), mapping(), state);
    expect(first.stats).toMatchObject({ files: 2, games: 1, hashed: 2 });
    expect(first.items[0]?.title).toBe('Alpha');
    state.recordScan(first.observations, first.items);
    expect((await scanLibrary(config(), mapping(), state)).stats).toMatchObject({ hashed: 0, cached: 2 });
    await writeFile(path.join(root, 'snes', 'Alpha.sfc'), 'different longer bytes');
    const changed = await scanLibrary(config(), mapping(), state);
    expect(changed.stats).toMatchObject({ hashed: 1, cached: 1, games: 2 });
  });
  it('skips junctions/symlinks and refuses redirected scan roots', async () => {
    await mkdir(path.join(root, 'external'));
    await writeFile(path.join(root, 'external', 'hidden.sfc'), 'external bytes');
    await symlink(path.join(root, 'external'), path.join(root, 'snes', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await scanLibrary(config(), mapping())).stats).toMatchObject({ games: 0, skippedLinks: 1 });
    const redirected = libraryConfigSchema.parse({ roots: [{ directory: 'snes/link', consoleSlug: 'snes', extensions: ['.sfc'] }] });
    await expect(scanLibrary(config(), redirected)).rejects.toThrow('SCAN_UNSAFE_ROOT');
  });
  it('does not replace persisted work after an incomplete scan', async () => {
    await writeFile(path.join(root, 'snes', 'fixture.sfc'), 'abc');
    state = await AgentState.open(config().AGENT_STATE_ROOT, binding);
    const result = await scanLibrary(config(), mapping());
    state.recordScan(result.observations, result.items);
    const missing = libraryConfigSchema.parse({ roots: [...mapping().roots, { directory: 'missing', consoleSlug: 'nes', extensions: ['.nes'] }] });
    await expect(scanLibrary(config(), missing, state)).rejects.toThrow();
    expect(state.status().pending).toBe(1);
  });
  it('rejects the same fingerprint assigned to different consoles', async () => {
    await mkdir(path.join(root, 'nes'));
    await writeFile(path.join(root, 'snes', 'a.sfc'), 'same');
    await writeFile(path.join(root, 'nes', 'b.nes'), 'same');
    const roots = libraryConfigSchema.parse({ roots: [...mapping().roots, { directory: 'nes', consoleSlug: 'nes', extensions: ['.nes'] }] });
    await expect(scanLibrary(config(), roots)).rejects.toThrow('SCAN_CONSOLE_CONFLICT');
  });
});

describe('durable queue and process ownership', () => {
  it('persists pending jobs and prevents a second process using the same state', async () => {
    state = await AgentState.open(config().AGENT_STATE_ROOT, binding);
    state.recordScan([], [{ title: 'Fixture', consoleSlug: 'snes', checksum: 'a'.repeat(64), sizeBytes: '3', hashAlgorithm: 'SHA256' }]);
    await expect(AgentState.open(config().AGENT_STATE_ROOT, binding)).rejects.toThrow('AGENT_ALREADY_RUNNING');
    state.close(); state = undefined;
    state = await AgentState.open(config().AGENT_STATE_ROOT, binding);
    expect(state.due()).toHaveLength(1);
    state.close(); state = undefined;
    await expect(AgentState.open(config().AGENT_STATE_ROOT, { ...binding, deviceId: randomUUID() })).rejects.toThrow('STATE_DEVICE_MISMATCH');
  });
  it('does not acknowledge a newer observation using an older response', async () => {
    state = await AgentState.open(config().AGENT_STATE_ROOT, binding);
    const item = { title: 'Old', consoleSlug: 'snes', checksum: 'a'.repeat(64), sizeBytes: '3', hashAlgorithm: 'SHA256' as const };
    state.recordScan([], [item]); const original = state.due()[0]!;
    state.recordScan([], [{ ...item, title: 'New' }]);
    state.acknowledge([{ job: original, entryId: randomUUID() }]);
    expect(state.status().pending).toBe(1);
    const current = state.due()[0]!;
    expect(current.item.title).toBe('New');
    state.acknowledge([{ job: current, entryId: randomUUID() }]);
    state.recordScan([], [{ ...item, title: 'New' }]);
    expect(state.status()).toMatchObject({ pending: 0, synced: 1 });
  });
});
