import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage, createStorageKey } from '../../api/src/local-storage.js';

const temporaryRoot = path.resolve('.tmp');
let sandbox: string;
let storage: LocalStorage;

beforeEach(async () => {
  await mkdir(temporaryRoot, { recursive: true });
  sandbox = await mkdtemp(path.join(temporaryRoot, 'storage-test-'));
  storage = new LocalStorage(path.join(sandbox, 'data'));
  await storage.initialize();
});

afterEach(async () => {
  const resolved = path.resolve(sandbox);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('storage-test-')) {
    throw new Error('Refusing to clean a directory outside the test sandbox');
  }
  await rm(resolved, { recursive: true, force: true });
});

describe('local immutable storage', () => {
  it('persists complete files across independent adapter instances', async () => {
    const key = createStorageKey('saves');
    const data = Buffer.from('synthetic save');
    await storage.put(key, data);
    const restarted = new LocalStorage(path.join(sandbox, 'data'));
    await restarted.initialize();
    expect(await restarted.read(key)).toEqual(data);
    await restarted.remove(key);
    await expect(storage.read(key)).rejects.toMatchObject({ code: 'ENOENT' });
    await restarted.remove(key);
  });

  it('never overwrites an existing version', async () => {
    const key = createStorageKey('saves');
    await storage.put(key, Buffer.from('original'));
    await expect(storage.put(key, Buffer.from('replacement'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await storage.read(key)).toString()).toBe('original');
    expect(await readdir(path.join(sandbox, 'data', 'saves'))).toEqual([key.split('/')[1]]);
  });

  it('publishes exactly one complete file during concurrent writes', async () => {
    const key = createStorageKey('captures');
    const a = Buffer.alloc(64 * 1024, 1);
    const b = Buffer.alloc(64 * 1024, 2);
    const outcomes = await Promise.allSettled([storage.put(key, a), storage.put(key, b)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await storage.read(key);
    expect(stored.equals(a) || stored.equals(b)).toBe(true);
    expect(await readdir(path.join(sandbox, 'data', 'captures'))).toHaveLength(1);
  });

  it.each(['../outside', 'saves/../../outside', 'saves\\outside', '/etc/passwd',
    'C:\\outside', 'saves/%2e%2e', 'captures/CON', 'other/123', 'saves//123', 'saves/123\0'])(
    'rejects unsafe key %s for all operations', async key => {
      await expect(storage.put(key, Buffer.from('invalid'))).rejects.toThrow();
      await expect(storage.read(key)).rejects.toThrow();
      await expect(storage.remove(key)).rejects.toThrow();
    },
  );

  it('checks read/write availability without leaving probe files', async () => {
    await storage.check();
    expect(await readdir(path.join(sandbox, 'data', 'saves'))).toEqual([]);
    expect(await readdir(path.join(sandbox, 'data', 'captures'))).toEqual([]);
  });

  it('fails readiness when storage was not initialized', async () => {
    await expect(new LocalStorage(path.join(sandbox, 'missing')).check()).rejects.toThrow();
  });

  it('rejects a namespace redirected by a symlink or Windows junction', async () => {
    const root = path.join(sandbox, 'linked-data');
    const outside = path.join(sandbox, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, 'sentinel'), 'unchanged');
    await symlink(outside, path.join(root, 'saves'), process.platform === 'win32' ? 'junction' : 'dir');
    const redirected = new LocalStorage(root);
    await expect(redirected.initialize()).rejects.toThrow('Unsafe storage directory');
    await expect(redirected.put(createStorageKey('saves'), Buffer.from('bad'))).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['sentinel']);
  });

  it('rejects a symlink used as the configured root', async () => {
    const outside = path.join(sandbox, 'outside');
    const linked = path.join(sandbox, 'linked-root');
    await mkdir(outside);
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new LocalStorage(linked).initialize()).rejects.toThrow('Unsafe storage directory');
  });
});
