import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { hashPassword, verifyPassword, AccessTokens, hashToken, newToken } from '../../api/src/auth/crypto.js';
import { librarySyncSchema, loginSchema, registerSchema } from '@retro-cloud/shared';

describe('passwords and bearer tokens', () => {
  it('salts passwords independently and verifies without storing plaintext', async () => {
    const password = 'test password longer than twelve';
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword('wrong password', a)).toBe(false);
    expect(await verifyPassword(password, undefined)).toBe(false);
    expect(await verifyPassword(password, 'scrypt$999999999$8$3$invalid')).toBe(false);
  }, 15000);
  it('issues signed tokens tied to a user and session', async () => {
    const tokens = new AccessTokens(randomBytes(32).toString('hex'));
    const user = randomUUID(), session = randomUUID();
    const jwt = await tokens.issue(user, session);
    expect(await tokens.verify(jwt)).toEqual({ sub: user, sid: session });
    await expect(new AccessTokens(randomBytes(32).toString('hex')).verify(jwt)).rejects.toMatchObject({ status: 401 });
  });
  it.each(['expired', 'issuer', 'audience', 'algorithm', 'missing-session'])('rejects %s JWT', async scenario => {
    const secret = randomBytes(32);
    const jwt = new SignJWT(scenario === 'missing-session' ? {} : { sid: randomUUID() })
      .setProtectedHeader({ alg: scenario === 'algorithm' ? 'HS384' : 'HS256', typ: 'JWT' })
      .setSubject(randomUUID()).setIssuedAt()
      .setIssuer(scenario === 'issuer' ? 'elsewhere' : 'retro-cloud')
      .setAudience(scenario === 'audience' ? 'agent' : 'retro-cloud-web')
      .setExpirationTime(scenario === 'expired' ? 1 : '15m');
    await expect(new AccessTokens(secret.toString('hex')).verify(await jwt.sign(secret))).rejects.toMatchObject({ status: 401 });
  });
  it('hashes high entropy opaque tokens', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});

describe('shared input contracts', () => {
  const item = { consoleSlug: 'snes', title: 'Sample', hashAlgorithm: 'SHA256', checksum: 'a'.repeat(64), sizeBytes: '123' };
  it('normalizes email, preserving password bytes', () => {
    expect(loginSchema.parse({ email: '  PLAYER@EXAMPLE.COM ', password: ' spaces matter ' }))
      .toEqual({ email: 'player@example.com', password: ' spaces matter ' });
    expect(registerSchema.safeParse({ email: 'a@example.com', password: 'short', displayName: 'A' }).success).toBe(false);
  });
  it.each([
    { checksum: 'A'.repeat(64) }, { checksum: 'x'.repeat(64) }, { sizeBytes: '18446744073709551616' },
    { sizeBytes: 123 }, { sizeBytes: '-1' }, { sizeBytes: '0' }, { sizeBytes: '01' },
    { rom: 'binary-data' }, { path: 'C:/ROMs/game.sfc' }, { title: 'bad\u0000title' }, { hashAlgorithm: 'MD5' },
  ])('rejects invalid fingerprints and unexpected data %j', change => {
    expect(librarySyncSchema.safeParse({ items: [{ ...item, ...change }] }).success).toBe(false);
  });
  it('accepts precise uint64 sizes and caps batch size', () => {
    expect(librarySyncSchema.parse({ items: [{ ...item, sizeBytes: '18446744073709551615' }] }).items).toHaveLength(1);
    expect(librarySyncSchema.safeParse({ items: Array(51).fill(item) }).success).toBe(false);
    expect(librarySyncSchema.safeParse({ items: [item], rom: 'unexpected' }).success).toBe(false);
  });
});
