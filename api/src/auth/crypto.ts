import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { unauthorized } from '../errors.js';

export const ACCESS_SECONDS = 900;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const prefix = 'scrypt$32768$8$3$';
const dummy = prefix + '0'.repeat(32) + '$' + '0'.repeat(128);
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return prefix + salt.toString('hex') + '$' + (await derive(password, salt)).toString('hex');
}
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const valid = stored !== undefined && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored);
  const parts = (valid ? stored : dummy).split('$');
  const derived = await derive(password, Buffer.from(parts[4]!, 'hex'));
  return timingSafeEqual(derived, Buffer.from(parts[5]!, 'hex')) && valid;
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const claims = z.object({ sub: z.uuid(), sid: z.uuid() });
export class AccessTokens {
  private readonly key: Uint8Array;
  constructor(secret: string) { this.key = Buffer.from(secret, 'hex'); }
  async issue(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId).setIssuer('retro-cloud').setAudience('retro-cloud-web')
      .setIssuedAt().setExpirationTime(ACCESS_SECONDS + 's').sign(this.key);
  }
  async verify(token: string): Promise<{ sub: string; sid: string }> {
    try {
      const result = await jwtVerify(token, this.key, {
        algorithms: ['HS256'], issuer: 'retro-cloud', audience: 'retro-cloud-web',
        typ: 'JWT', requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      });
      return claims.parse(result.payload);
    } catch { throw unauthorized(); }
  }
}
