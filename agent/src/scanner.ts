import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { libraryItemSchema } from '@retro-cloud/shared';
import type { LibrarySync } from '@retro-cloud/shared';
import type { AgentConfig, LibraryConfig } from './config.js';
import { hashFile, signature } from './hash.js';
import { AgentError } from './errors.js';

export type LibraryItem = LibrarySync['items'][number];
export type Observation = { path: string; signature: string; item: LibraryItem };
export interface ScanCache { cached(file: string, signature: string): LibraryItem | undefined }
export const fingerprint = (item: LibraryItem) => item.checksum + ':' + item.sizeBytes;
function inside(base: string, target: string) {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export async function scanLibrary(config: AgentConfig, library: LibraryConfig, cache?: ScanCache, signal?: AbortSignal) {
  const baseStat = await lstat(config.AGENT_ROMS_ROOT);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new AgentError('SCAN_UNSAFE_ROOT');
  const base = await realpath(config.AGENT_ROMS_ROOT);
  const observations: Observation[] = [];
  const seen = new Set<string>();
  const items = new Map<string, LibraryItem>();
  let hashed = 0, cached = 0, skippedLinks = 0, examined = 0;
  async function visit(folder: string, root: LibraryConfig['roots'][number], depth: number) {
    signal?.throwIfAborted();
    if (depth > 64) throw new AgentError('SCAN_DEPTH_LIMIT');
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (++examined > config.AGENT_MAX_FILES) throw new AgentError('SCAN_FILE_LIMIT');
      const file = path.join(folder, entry.name);
      const stat = await lstat(file, { bigint: true });
      if (stat.isSymbolicLink()) { skippedLinks++; continue; }
      if (!inside(base, await realpath(file))) throw new AgentError('SCAN_UNSAFE_FILE');
      if (stat.isDirectory()) { await visit(file, root, depth + 1); continue; }
      if (!stat.isFile() || !root.extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      if (seen.has(file)) throw new AgentError('SCAN_OVERLAPPING_ROOTS');
      seen.add(file);
      const stamp = signature(stat);
      const previous = cache?.cached(file, stamp);
      const result = previous ?? await hashFile(file, signal);
      if (previous) cached++; else hashed++;
      const title = path.parse(entry.name).name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255) || 'Untitled game';
      const item = libraryItemSchema.parse({ consoleSlug: root.consoleSlug, title,
        hashAlgorithm: 'SHA256', checksum: result.checksum, sizeBytes: result.sizeBytes });
      const key = fingerprint(item);
      const duplicate = items.get(key);
      if (duplicate && duplicate.consoleSlug !== item.consoleSlug) throw new AgentError('SCAN_CONSOLE_CONFLICT');
      if (!duplicate) items.set(key, item);
      observations.push({ path: file, signature: 'signature' in result ? result.signature : stamp, item });
    }
  }
  for (const root of library.roots) {
    let folder = base;
    for (const part of root.directory.split(/[\\/]/)) {
      folder = path.join(folder, part);
      const stat = await lstat(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !inside(base, await realpath(folder))) throw new AgentError('SCAN_UNSAFE_ROOT');
    }
    await visit(folder, root, 0);
  }
  return { observations, items: [...items.values()], stats: { files: observations.length, games: items.size, hashed, cached, skippedLinks } };
}
