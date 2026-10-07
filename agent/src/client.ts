import { z } from 'zod';
import { libraryItemSchema, librarySyncSchema } from '@retro-cloud/shared';
import type { LibraryItem } from './scanner.js';
import { fingerprint } from './scanner.js';
import { AgentError } from './errors.js';

export class SyncError extends AgentError {
  constructor(code: string, public readonly global: boolean, public readonly retryAfterMs = 0) { super(code); }
}
const replySchema = z.object({ items: z.array(z.object({
  id: z.uuid(), device: z.object({ id: z.uuid() }), title: z.string(),
  console: z.object({ slug: z.string() }),
  file: z.object({ hashAlgorithm: z.literal('SHA256'), checksum: libraryItemSchema.shape.checksum, sizeBytes: libraryItemSchema.shape.sizeBytes }),
})).max(50) });
export const payloadBytes = (items: LibraryItem[]) => Buffer.byteLength(JSON.stringify({ items }), 'utf8');
export function batchJobs<T extends { item: LibraryItem }>(jobs: T[]): T[] {
  const batch: T[] = [];
  for (const job of jobs) {
    if (batch.length >= 50 || payloadBytes([...batch.map(value => value.item), job.item]) > 28 * 1024) break;
    batch.push(job);
  }
  if (jobs.length && !batch.length) throw new AgentError('BATCH_ITEM_TOO_LARGE');
  return batch;
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const milliseconds = /^[0-9]+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(milliseconds, 86400000)) : 0;
}
export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly deviceId: string,
    private readonly timeoutMs = 15000, private readonly request: typeof fetch = fetch) {}
  async send(items: LibraryItem[], signal?: AbortSignal): Promise<Map<string, string>> {
    const body = JSON.stringify(librarySyncSchema.parse({ items }));
    if (Buffer.byteLength(body) > 32 * 1024) throw new SyncError('HTTP_413', false);
    try {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const response = await this.request(this.baseUrl + '/agent/library', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey },
        body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        const global = response.status >= 500 || [401, 403, 404, 408, 429].includes(response.status);
        throw new SyncError('HTTP_' + response.status, global, retryAfter(response.headers.get('retry-after')));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SyncError('INVALID_API_RESPONSE', true);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 256 * 1024) { await reader.cancel(); throw new SyncError('INVALID_API_RESPONSE', true); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      let reply: z.infer<typeof replySchema>;
      try { reply = replySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { throw new SyncError('INVALID_API_RESPONSE', true); }
      const expected = new Map(items.map(item => [fingerprint(item), item]));
      const accepted = new Map<string, string>();
      for (const row of reply.items) {
        const key = fingerprint({ ...row.file, title: row.title, consoleSlug: row.console.slug });
        const item = expected.get(key);
        if (!item || accepted.has(key) || row.device.id !== this.deviceId || row.title !== item.title || row.console.slug !== item.consoleSlug) {
          throw new SyncError('INVALID_API_RESPONSE', true);
        }
        accepted.set(key, row.id);
      }
      if (accepted.size !== expected.size) throw new SyncError('INVALID_API_RESPONSE', true);
      return accepted;
    } catch (error) {
      if (signal?.aborted) throw new AgentError('AGENT_STOPPING');
      if (error instanceof SyncError) throw error;
      throw new SyncError('NETWORK_UNAVAILABLE', true);
    }
  }
}
