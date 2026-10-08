import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { playSessionSchema, sessionQuerySchema } from '@retro-cloud/shared';
const base = { clientSessionId: randomUUID(), gameId: randomUUID(), startedAt: '2026-01-01T00:00:00.000Z' };
describe('session contracts', () => {
  it('accepts an open session and normalizes missing closure', () => {
    expect(playSessionSchema.parse(base)).toMatchObject({ endedAt: null, durationSeconds: null });
  });
  it('accepts paused time smaller than wall time', () => {
    expect(playSessionSchema.safeParse({ ...base, endedAt: '2026-01-01T00:01:00.000Z', durationSeconds: 30 }).success).toBe(true);
  });
  it.each([
    { endedAt: '2026-01-01T00:01:00.000Z' },
    { durationSeconds: 30 },
    { endedAt: '2025-12-31T23:59:59.000Z', durationSeconds: 0 },
    { endedAt: '2026-01-01T00:00:00.999Z', durationSeconds: 1 },
    { endedAt: '2026-01-01T00:01:00.000Z', durationSeconds: -1 },
    { endedAt: '2026-01-01T00:01:00.000Z', durationSeconds: 1.5 },
    { startedAt: '2026-01-01T00:00:00Z' },
    { userId: randomUUID() },
  ])('rejects invalid input %j', extra => {
    expect(playSessionSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
  it('rejects reversed ranges and unbounded pagination', () => {
    expect(sessionQuerySchema.safeParse({ from: base.startedAt, to: base.startedAt }).success).toBe(false);
    expect(sessionQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
