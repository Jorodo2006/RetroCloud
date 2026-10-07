import path from 'node:path';
import { mkdir, lstat, chmod } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { libraryItemSchema } from '@retro-cloud/shared';
import type { LibraryItem, Observation, ScanCache } from './scanner.js';
import { fingerprint } from './scanner.js';
import { AgentError } from './errors.js';

const jobSchema = z.object({
  key: z.string(), payload: z.string(), revision: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
});
export interface Job { key: string; item: LibraryItem; revision: number; attempts: number }
export class AgentState implements ScanCache {
  private constructor(private readonly db: DatabaseSync, private readonly lock: DatabaseSync) {}
  static async open(root: string, binding: { apiUrl: string; deviceId: string }) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const folder = await lstat(root);
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw new AgentError('STATE_UNSAFE_PATH');
    for (const name of ['agent.sqlite', 'agent.sqlite-wal', 'agent.sqlite-shm', 'lock.sqlite', 'lock.sqlite-journal']) {
      try {
        const stat = await lstat(path.join(root, name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new AgentError('STATE_UNSAFE_PATH');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    const lock = new DatabaseSync(path.join(root, 'lock.sqlite'));
    let db: DatabaseSync | undefined;
    try {
      try { lock.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY)'); }
      catch { throw new AgentError('AGENT_ALREADY_RUNNING'); }
      db = new DatabaseSync(path.join(root, 'agent.sqlite'));
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1) throw new AgentError('STATE_VERSION_UNSUPPORTED');
      db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, signature TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS jobs (
          key TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','synced','blocked')),
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
          error_code TEXT, entry_id TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, next_attempt);
        PRAGMA user_version=1;
        COMMIT;`);
      const identity = JSON.stringify(binding);
      const stored = db.prepare("SELECT value FROM meta WHERE key='binding'").get();
      if (stored && stored.value !== identity) throw new AgentError('STATE_DEVICE_MISMATCH');
      db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES ('binding',?)").run(identity);
      for (const name of ['agent.sqlite', 'lock.sqlite']) await chmod(path.join(root, name), 0o600);
      return new AgentState(db, lock);
    } catch (error) {
      db?.close(); lock.close(); throw error;
    }
  }
  close() { try { this.db.close(); } finally { this.lock.close(); } }
  private transaction(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try { work(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cached(file: string, signature: string) {
    const row = this.db.prepare('SELECT payload FROM files WHERE path=? AND signature=?').get(file, signature);
    if (!row || typeof row.payload !== 'string') return undefined;
    return libraryItemSchema.parse(JSON.parse(row.payload));
  }
  recordScan(observations: Observation[], items: LibraryItem[]) {
    // Only a completed scan replaces the cache. Pending observations survive failed scans and restarts.
    const validated = items.map(item => libraryItemSchema.parse(item));
    this.transaction(() => {
      this.db.exec('DELETE FROM files');
      const file = this.db.prepare('INSERT INTO files(path,signature,payload) VALUES (?,?,?)');
      for (const entry of observations) file.run(entry.path, entry.signature, JSON.stringify(entry.item));
      const enqueue = this.db.prepare(`INSERT INTO jobs(key,payload,revision,status) VALUES (?,?,1,'pending')
        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, revision=jobs.revision+1,
          status='pending',attempts=0,next_attempt=0,error_code=NULL
        WHERE jobs.payload<>excluded.payload`);
      for (const item of validated) enqueue.run(fingerprint(item), JSON.stringify(item));
    });
  }
  due(now = Date.now(), limit = 50): Job[] {
    const global = this.db.prepare("SELECT value FROM meta WHERE key='sync_after'").get();
    if (global && Number(global.value) > now) return [];
    return this.db.prepare("SELECT key,payload,revision,attempts FROM jobs WHERE status='pending' AND next_attempt<=? ORDER BY key LIMIT ?")
      .all(now, limit).map(value => {
        const row = jobSchema.parse(value);
        return { key: row.key, item: libraryItemSchema.parse(JSON.parse(row.payload)), revision: row.revision, attempts: row.attempts };
      });
  }
  acknowledge(jobs: { job: Job; entryId: string }[]) {
    this.transaction(() => {
      const update = this.db.prepare("UPDATE jobs SET status='synced', attempts=0,next_attempt=0,error_code=NULL,entry_id=? WHERE key=? AND revision=?");
      for (const { job, entryId } of jobs) update.run(entryId, job.key, job.revision);
    });
  }
  fail(jobs: Job[], code: string, blocked: boolean, retryAt: number, global: boolean) {
    this.transaction(() => {
      const update = this.db.prepare('UPDATE jobs SET status=?,attempts=MIN(attempts+1,30),next_attempt=?,error_code=? WHERE key=? AND revision=?');
      for (const job of jobs) update.run(blocked ? 'blocked' : 'pending', retryAt, code, job.key, job.revision);
      if (global) this.db.prepare("INSERT INTO meta(key,value) VALUES ('sync_after',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(retryAt));
    });
  }
  retry() {
    this.transaction(() => {
      this.db.exec("UPDATE jobs SET status='pending',attempts=0,next_attempt=0,error_code=NULL WHERE status<>'synced'; DELETE FROM meta WHERE key='sync_after'");
    });
  }
  status() {
    const result = { pending: 0, synced: 0, blocked: 0 };
    for (const row of this.db.prepare('SELECT status,COUNT(*) AS count FROM jobs GROUP BY status').all()) {
      const status = z.enum(['pending', 'synced', 'blocked']).parse(row.status);
      result[status] = z.number().parse(row.count);
    }
    const errors = this.db.prepare("SELECT error_code AS code,COUNT(*) AS count FROM jobs WHERE error_code IS NOT NULL GROUP BY error_code").all();
    return { ...result, errors };
  }
}
