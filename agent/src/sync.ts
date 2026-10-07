import type { AgentState, Job } from './state.js';
import type { ApiClient } from './client.js';
import { batchJobs, SyncError } from './client.js';
import { AgentError } from './errors.js';

export function backoff(attempts: number, random = Math.random): number {
  return Math.ceil(Math.min(300000, 1000 * 2 ** Math.min(attempts, 9)) * (0.75 + random() * 0.25));
}
export async function flushQueue(state: AgentState, client: Pick<ApiClient, 'send'>, signal?: AbortSignal) {
  let sent = 0, blocked = 0, deferred = false;
  async function send(jobs: Job[]): Promise<boolean> {
    signal?.throwIfAborted();
    try {
      const accepted = await client.send(jobs.map(job => job.item), signal);
      state.acknowledge(jobs.map(job => {
        const entryId = accepted.get(job.key);
        if (!entryId) throw new AgentError('INVALID_ACKNOWLEDGEMENT');
        return { job, entryId };
      }));
      sent += jobs.length;
      return true;
    } catch (error) {
      if (!(error instanceof SyncError)) throw error;
      if (!error.global && jobs.length > 1) {
        const middle = Math.floor(jobs.length / 2);
        return await send(jobs.slice(0, middle)) && await send(jobs.slice(middle));
      }
      const retryMs = Math.max(error.retryAfterMs, backoff(Math.max(...jobs.map(job => job.attempts))),
        ['HTTP_401', 'HTTP_403', 'HTTP_404'].includes(error.code) ? 60000 : 0);
      state.fail(jobs, error.code, !error.global, Date.now() + retryMs, error.global);
      if (error.global) deferred = true; else blocked += jobs.length;
      return !error.global;
    }
  }
  while (!signal?.aborted) {
    const jobs = batchJobs(state.due());
    if (!jobs.length || !await send(jobs)) break;
  }
  return { sent, newlyBlocked: blocked, deferred, ...state.status() };
}
