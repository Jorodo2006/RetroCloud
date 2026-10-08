import { playSessionSchema, sessionQuerySchema } from '@retro-cloud/shared';
import { SessionService } from './sessions/service.js';
import { Router } from 'express';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { registerSchema, loginSchema, deviceSchema, idSchema, emptyBodySchema, libraryQuerySchema, librarySyncSchema } from '@retro-cloud/shared';
import type { Config } from './config.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { AuthService } from './auth/service.js';
import { DeviceService } from './devices/service.js';
import { LibraryService } from './library/service.js';
import { requireUser } from './middleware/auth.js';
import { ApiError, unauthorized } from './errors.js';

export interface ApiContext { database: PrismaClient; config: Config }
export const REFRESH_COOKIE = 'retro_refresh';
function refreshCookie(req: Request): string | undefined {
  const cookies = (req.get('Cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(REFRESH_COOKIE + '='));
  if (cookies.length !== 1) return undefined;
  const value = cookies[0]!.slice(REFRESH_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function routes({ database, config }: ApiContext) {
  const router = Router();
  const auth = new AuthService(database, config);
  const devices = new DeviceService(database);
  const library = new LibraryService(database);
  const user = requireUser(auth);
  const device = devices.middleware();
  const cookieOptions: CookieOptions = { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: '/auth' };
  const browserGuard: RequestHandler = (req, _res, next) => {
    // The custom header prevents simple cross-origin requests; CORS is deliberately not enabled.
    if (req.get('X-Retro-Client') !== 'web' || (req.get('Origin') && req.get('Origin') !== config.APP_ORIGIN)) {
      throw new ApiError(403, 'ORIGIN_REJECTED', 'Request origin or client header rejected');
    }
    next();
  };
  const limiter = (limit: number) => rateLimit({
    windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many requests; try again later')),
  });
  const credentialsLimit = limiter(20);
  const refreshLimit = limiter(120);
  function sendSession(res: Response, result: Awaited<ReturnType<AuthService['refresh']>>, status = 200) {
    const { refreshToken, refreshExpiresAt, ...body } = result;
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, expires: refreshExpiresAt });
    res.status(status).json(body);
  }
  router.post('/auth/register', browserGuard, credentialsLimit, async (req, res) => {
    sendSession(res, await auth.register(registerSchema.parse(req.body)), 201);
  });
  router.post('/auth/login', browserGuard, credentialsLimit, async (req, res) => {
    sendSession(res, await auth.login(loginSchema.parse(req.body)));
  });
  router.post('/auth/refresh', browserGuard, refreshLimit, async (req, res) => {
    emptyBodySchema.parse(req.body ?? {});
    const raw = refreshCookie(req);
    if (!raw) throw unauthorized();
    try { sendSession(res, await auth.refresh(raw)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw error;
    }
  });
  router.post('/auth/logout', browserGuard, async (req, res) => {
    emptyBodySchema.parse(req.body ?? {});
    await auth.logout(refreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.sendStatus(204);
  });
  router.get('/auth/me', user, async (_req, res) => res.json({ user: await auth.profile(res.locals.principal!.userId) }));
  router.post('/devices', user, async (req, res) => {
    const input = deviceSchema.parse(req.body);
    res.status(201).json(await devices.create(res.locals.principal!.userId, input.name));
  });
  router.get('/devices', user, async (req, res) => {
    const { limit, offset } = libraryQuerySchema.pick({ limit: true, offset: true }).parse(req.query);
    res.json(await devices.list(res.locals.principal!.userId, limit, offset));
  });
  router.post('/devices/:id/key', user, async (req, res) => {
    emptyBodySchema.parse(req.body ?? {});
    res.json(await devices.rotate(res.locals.principal!.userId, idSchema.parse(req.params.id)));
  });
  router.delete('/devices/:id', user, async (req, res) => {
    await devices.revoke(res.locals.principal!.userId, idSchema.parse(req.params.id));
    res.sendStatus(204);
  });
  router.get('/consoles', user, async (_req, res) => res.json(await library.consoles()));
  router.get('/library', user, async (req, res) => {
    res.json(await library.list(res.locals.principal!.userId, libraryQuerySchema.parse(req.query)));
  });
  router.get('/library/:id', user, async (req, res) => {
    res.json(await library.get(res.locals.principal!.userId, idSchema.parse(req.params.id)));
  });
  router.post('/agent/library', device, async (req, res) => {
    res.json(await library.sync(res.locals.device!, librarySyncSchema.parse(req.body)));
  });
  router.delete('/agent/library/:id', device, async (req, res) => {
    await library.remove(res.locals.device!, idSchema.parse(req.params.id));
    res.sendStatus(204);
  });
  const sessions = new SessionService(database);
  router.post('/agent/sessions', device, async (req, res) => {
    res.json(await sessions.sync(res.locals.device!, playSessionSchema.parse(req.body)));
  });
  router.get('/sessions', user, async (req, res) => {
    res.json(await sessions.list(res.locals.principal!.userId, sessionQuerySchema.parse(req.query)));
  });
  router.get('/stats', user, async (req, res) => {
    res.json(await sessions.stats(res.locals.principal!.userId, sessionQuerySchema.parse(req.query)));
  });
  return router;
}
