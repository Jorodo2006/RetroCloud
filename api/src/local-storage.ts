import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';

export const storageKeySchema = z.string().regex(
  /^(saves|captures)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  'Use a storage namespace and a UUID, never a filesystem path',
);
export type StorageNamespace = 'saves' | 'captures';

export function createStorageKey(namespace: StorageNamespace): string {
  return storageKeySchema.parse(namespace + '/' + randomUUID());
}

export class LocalStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root) || root.includes('\0')) throw new Error('Storage root must be absolute');
    this.root = path.resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.directory(this.root);
    for (const namespace of ['saves', 'captures'] as const) {
      const directory = path.join(this.root, namespace);
      await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
        if (!hasCode(error, 'EEXIST')) throw error;
      });
      await this.directory(directory);
    }
  }

  private async directory(directory: string): Promise<void> {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe storage directory');
    const root = await realpath(this.root);
    const relative = path.relative(root, await realpath(directory));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Storage directory outside root');
    }
  }

  private async location(key: string): Promise<string> {
    storageKeySchema.parse(key);
    await this.directory(this.root);
    const namespace = key.split('/')[0]!;
    const directory = path.join(this.root, namespace);
    await this.directory(directory);
    return path.join(directory, key.slice(namespace.length + 1));
  }

  // Publish only complete files. Hard-link creation is atomic and never overwrites a version.
  // The root must be owned exclusively by the API; concurrent external filesystem edits are unsupported.
  async put(key: string, data: Uint8Array): Promise<void> {
    const destination = await this.location(key);
    const temporary = path.join(path.dirname(destination), '.pending-' + randomUUID());
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await link(temporary, destination);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      });
    }
  }

  async read(key: string): Promise<Buffer> {
    const destination = await this.location(key);
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe storage file');
    const file = await open(destination, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!(await file.stat()).isFile()) throw new Error('Unsafe storage file');
      return await file.readFile();
    } finally {
      await file.close();
    }
  }

  async remove(key: string): Promise<void> {
    const destination = await this.location(key);
    try {
      const info = await lstat(destination);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe storage file');
      await unlink(destination);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }

  async check(): Promise<void> {
    for (const namespace of ['saves', 'captures'] as const) {
      const key = createStorageKey(namespace);
      const probe = Buffer.from('retro-cloud-storage-health');
      let written = false;
      try {
        await this.put(key, probe);
        written = true;
        if (!(await this.read(key)).equals(probe)) throw new Error('Storage integrity check failed');
      } finally {
        if (written) await this.remove(key);
      }
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function createStorage(config: Pick<Config, 'STORAGE_ROOT'>): LocalStorage {
  return new LocalStorage(config.STORAGE_ROOT);
}
