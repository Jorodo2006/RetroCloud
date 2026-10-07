import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { AgentError } from './errors.js';

export function signature(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
export interface FileReader {
  stat(): Promise<BigIntStats>;
  read(buffer: Buffer): Promise<number>;
}
export async function digestReader(reader: FileReader, signal?: AbortSignal) {
  const before = await reader.stat();
  if (!before.isFile() || before.size <= 0n) throw new AgentError('SCAN_INVALID_FILE');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const hash = createHash('sha256');
  let total = 0n;
  while (total < before.size) {
    signal?.throwIfAborted();
    const remaining = before.size - total;
    const length = remaining < BigInt(buffer.length) ? Number(remaining) : buffer.length;
    const bytes = await reader.read(buffer.subarray(0, length));
    if (bytes <= 0 || bytes > length) throw new AgentError('SCAN_FILE_CHANGED');
    hash.update(buffer.subarray(0, bytes));
    total += BigInt(bytes);
  }
  const after = await reader.stat();
  if (signature(before) !== signature(after)) throw new AgentError('SCAN_FILE_CHANGED');
  return { checksum: hash.digest('hex'), sizeBytes: total.toString(), signature: signature(after) };
}
export async function hashFile(file: string, signal?: AbortSignal) {
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new AgentError('SCAN_UNSAFE_FILE');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (signature(await handle.stat({ bigint: true })) !== signature(before)) throw new AgentError('SCAN_FILE_CHANGED');
    const result = await digestReader({
      stat: () => handle.stat({ bigint: true }),
      read: async buffer => (await handle.read(buffer, 0, buffer.length, null)).bytesRead,
    }, signal);
    const after = await lstat(file, { bigint: true });
    if (after.isSymbolicLink() || signature(after) !== result.signature) throw new AgentError('SCAN_FILE_CHANGED');
    return result;
  } finally { await handle.close(); }
}
