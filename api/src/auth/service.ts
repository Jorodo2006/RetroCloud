import type { Login, Registration } from '@retro-cloud/shared';
import type { Config } from '../config.js';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { ApiError, hasCode, unauthorized } from '../errors.js';
import { AccessTokens, hashPassword, verifyPassword, hashToken, newToken, SESSION_SECONDS, ACCESS_SECONDS } from './crypto.js';

export const publicUser = { id: true, email: true, displayName: true, createdAt: true } as const;
export class AuthService {
  readonly tokens: AccessTokens;
  constructor(private readonly db: PrismaClient, private readonly config: Config) {
    this.tokens = new AccessTokens(config.JWT_SECRET);
  }
  private async session(tx: Prisma.TransactionClient, userId: string) {
    const refreshToken = newToken();
    const session = await tx.authSession.create({ data: {
      userId, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      tokens: { create: { tokenHash: hashToken(refreshToken) } },
    } });
    return { session, refreshToken };
  }
  private async response(data: Awaited<ReturnType<AuthService['session']>>) {
    return {
      accessToken: await this.tokens.issue(data.session.userId, data.session.id),
      expiresIn: ACCESS_SECONDS, tokenType: 'Bearer', refreshToken: data.refreshToken,
      refreshExpiresAt: data.session.expiresAt,
    };
  }
  async register(input: Registration) {
    if (this.config.REGISTRATION_MODE === 'closed') throw new ApiError(403, 'REGISTRATION_CLOSED', 'Registration is closed');
    const passwordHash = await hashPassword(input.password);
    try {
      const result = await this.db.$transaction(async tx => {
        // A permanent singleton serializes first-user registration across API processes.
        await tx.$queryRaw`SELECT id FROM registration_gate WHERE id = 1 FOR UPDATE`;
        const gate = await tx.registrationGate.findUniqueOrThrow({ where: { id: 1 } });
        if (this.config.REGISTRATION_MODE === 'first-user' && (gate.claimed || await tx.user.count() > 0)) {
          throw new ApiError(403, 'REGISTRATION_CLOSED', 'Registration is closed');
        }
        const user = await tx.user.create({ data: {
          email: input.email, displayName: input.displayName, passwordHash,
        }, select: publicUser });
        await tx.registrationGate.update({ where: { id: 1 }, data: { claimed: true } });
        return { user, ...await this.session(tx, user.id) };
      });
      return { user: result.user, ...await this.response(result) };
    } catch (error) {
      if (hasCode(error, 'P2002')) throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'Account cannot be created');
      throw error;
    }
  }
  async login(input: Login) {
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    if (!await verifyPassword(input.password, user?.passwordHash) || !user) throw unauthorized();
    const data = await this.db.$transaction(tx => this.session(tx, user.id));
    const { id, email, displayName, createdAt } = user;
    return { user: { id, email, displayName, createdAt }, ...await this.response(data) };
  }
  async authenticate(token: string) {
    const { sub, sid } = await this.tokens.verify(token);
    const session = await this.db.authSession.findFirst({ where: {
      id: sid, userId: sub, revokedAt: null, expiresAt: { gt: new Date() },
    } });
    if (!session) throw unauthorized();
    return { userId: sub, sessionId: sid };
  }
  async refresh(raw: string) {
    const old = await this.db.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!old) throw unauthorized();
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${old.sessionId} FOR UPDATE`;
      const token = await tx.refreshToken.findUnique({ where: { id: old.id }, include: { session: true } });
      if (!token || token.session.revokedAt || token.session.expiresAt <= new Date()) return null;
      if (token.usedAt) {
        // Return instead of throwing: revocation must commit when a token is replayed.
        await tx.authSession.update({ where: { id: token.sessionId }, data: { revokedAt: new Date() } });
        return null;
      }
      const refreshToken = newToken();
      await tx.refreshToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      await tx.refreshToken.create({ data: { sessionId: token.sessionId, tokenHash: hashToken(refreshToken) } });
      return { session: token.session, refreshToken };
    });
    if (!result) throw unauthorized();
    return this.response(result);
  }
  async logout(raw: string | undefined) {
    if (!raw) return;
    const token = await this.db.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (token) await this.db.authSession.updateMany({ where: { id: token.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  async profile(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: publicUser });
    if (!user) throw unauthorized();
    return user;
  }
}
