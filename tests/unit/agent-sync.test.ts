import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentState } from '../../agent/src/state.js';
import { ApiClient, batchJobs, payloadBytes, retryAfter, SyncError } from '../../agent/src/client.js';
import { backoff, flushQueue } from '../../agent/src/sync.js';
import { fingerprint } from '../../agent/src/scanner.js';
import type { LibraryItem } from '../../agent/src/scanner.js';

let root = '';
let state: AgentState;
const deviceId = randomUUID();
const binding = { apiUrl: 'http://localhost:3000', deviceId };
const item = (checksum = 'a'.repeat(64)): LibraryItem => ({ consoleSlug: 'snes', title: 'Synthetic fixture', hashAlgorithm: 'SHA256', checksum, sizeBytes: '123' });
const reply = (items: LibraryItem[], id = deviceId) => Response.json({ items: items.map(value => ({
  id: randomUUID(), device: { id }, title: value.title, console: { slug: value.consoleSlug },
  file: { hashAlgorithm: value.hashAlgorithm, checksum: value.checksum, sizeBytes: value.sizeBytes },
})) });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'retro-agent-sync-'));
  state = await AgentState.open(root, binding);
});
afterEach(async () => {
  vi.restoreAllMocks();
  state.close();
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('retro-agent-sync-')) throw new Error('Unsafe test cleanup');
  await rm(root, { recursive: true, force: true });
});

describe('agent synchronization', () => {
  it('sends only the accepted metadata and never follows redirects', async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      expect(options?.redirect).toBe('error');
      expect(JSON.parse(String(options?.body))).toEqual({ items: [item()] });
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Api-Key': 'test-only-key' });
      return reply([item()]);
    });
    state.recordScan([], [item()]);
    const result = await flushQueue(state, new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 1000, request));
    expect(result).toMatchObject({ sent: 1, pending: 0, synced: 1 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('retains work after connection failure and resumes after restart', async () => {
    state.recordScan([], [item()]);
    const request = vi.fn<typeof fetch>(async () => { throw new Error('do not expose credentials'); });
    const client = new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 1000, request);
    expect(await flushQueue(state, client)).toMatchObject({ pending: 1, deferred: true });
    state.close(); state = await AgentState.open(root, binding);
    expect(state.status().pending).toBe(1);
    expect(state.due()).toEqual([]);
    state.retry();
    request.mockImplementation(async () => reply([item()]));
    expect(await flushQueue(state, client)).toMatchObject({ pending: 0, synced: 1 });
  });
  it('automatically retries after the persisted deadline without an operator reset', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    state.recordScan([], [item()]);
    const request = vi.fn<typeof fetch>(async () => new Response('', { status: 503, headers: { 'Retry-After': '2' } }));
    const client = new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 1000, request);
    await flushQueue(state, client);
    state.close(); state = await AgentState.open(root, binding);
    clock.mockReturnValue(11999);
    await flushQueue(state, client);
    expect(request).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(12000);
    request.mockImplementation(async () => reply([item()]));
    expect(await flushQueue(state, client)).toMatchObject({ pending: 0, synced: 1 });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('keeps jobs pending after the request times out', async () => {
    state.recordScan([], [item()]);
    const request = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    expect(await flushQueue(state, new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 20, request)))
      .toMatchObject({ pending: 1, synced: 0, deferred: true });
  });
  it('isolates a permanent bad item without blocking good items', async () => {
    state.recordScan([], [item(), { ...item('b'.repeat(64)), consoleSlug: 'unknown' }]);
    const send = vi.fn(async (items: LibraryItem[]) => {
      if (items.some(value => value.consoleSlug === 'unknown')) throw new SyncError('HTTP_400', false);
      return new Map(items.map(value => [fingerprint(value), randomUUID()]));
    });
    expect(await flushQueue(state, { send })).toMatchObject({ sent: 1, blocked: 1, pending: 0 });
    expect(send).toHaveBeenCalledTimes(3);
    state.retry();
    expect(state.status()).toMatchObject({ pending: 1, synced: 1 });
  });
  it.each([401, 403, 404, 408, 429, 503])('defers the whole connection on HTTP %s', async status => {
    state.recordScan([], [item()]);
    const request = vi.fn<typeof fetch>(async () => new Response('', { status, headers: { 'Retry-After': '60' } }));
    const client = new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 1000, request);
    expect(await flushQueue(state, client)).toMatchObject({ pending: 1, blocked: 0, deferred: true });
    await flushQueue(state, client);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong-device', 'missing-item', 'invalid-json', 'oversized'])('does not acknowledge %s replies', async kind => {
    state.recordScan([], [item()]);
    const request = vi.fn<typeof fetch>(async () => {
      if (kind === 'wrong-device') return reply([item()], randomUUID());
      if (kind === 'missing-item') return reply([]);
      return new Response(kind === 'oversized' ? 'x'.repeat(300000) : 'not json');
    });
    expect(await flushQueue(state, new ApiClient(binding.apiUrl, 'test-only-key', deviceId, 1000, request)))
      .toMatchObject({ pending: 1, synced: 0, deferred: true });
  });
  it('caps UTF-8 byte size and item count independently', () => {
    const jobs = Array.from({ length: 100 }, () => ({ item: { ...item(), title: '🎮'.repeat(127) } }));
    const batch = batchJobs(jobs);
    expect(batch.length).toBeLessThan(50);
    expect(payloadBytes(batch.map(value => value.item))).toBeLessThanOrEqual(28 * 1024);
    expect(batchJobs(Array.from({ length: 60 }, () => ({ item: item() })))).toHaveLength(50);
  });
  it('backs off with a cap and parses Retry-After safely', () => {
    expect(backoff(0, () => 1)).toBe(1000);
    expect(backoff(30, () => 1)).toBe(300000);
    expect(retryAfter('120')).toBe(120000);
    expect(retryAfter('Wed, 07 Oct 2026 12:01:00 GMT', Date.parse('2026-10-07T12:00:00Z'))).toBe(60000);
    expect(retryAfter('invalid')).toBe(0);
    expect(retryAfter('999999999')).toBe(86400000);
  });
});
