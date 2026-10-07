import type { RequestHandler } from 'express';
import type { AuthService } from '../auth/service.js';
import { unauthorized } from '../errors.js';

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      principal?: { userId: string; sessionId: string };
      device?: { deviceId: string; keyId: string };
    }
  }
}
export function requireUser(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('Authorization');
    if (!header?.startsWith('Bearer ') || header.length > 4096) throw unauthorized();
    res.locals.principal = await auth.authenticate(header.slice(7));
    next();
  };
}
