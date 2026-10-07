import { randomUUID } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { healthResponseSchema } from '@retro-cloud/shared';

export interface HealthChecks {
  database: () => Promise<void>;
  storage: () => Promise<void>;
}

export function createApp(logger: Logger, checks: HealthChecks) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => {
      // Do not log URLs/queries, bodies or headers: future auth may contain secrets.
      logger.info({ requestId, status: res.statusCode, durationMs: Math.round(performance.now() - started) }, 'request completed');
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/health/live', (_req, res) => {
    res.json(healthResponseSchema.parse({ status: 'ok' }));
  });
  app.get('/health/ready', async (_req, res) => {
    const results = await Promise.allSettled([checks.database(), checks.storage()]);
    const dependencies = { database: results[0]?.status === 'fulfilled', storage: results[1]?.status === 'fulfilled' };
    const ready = dependencies.database && dependencies.storage;
    if (!ready) logger.warn({ requestId: res.locals.requestId, checks: dependencies }, 'dependencies unavailable');
    res.status(ready ? 200 : 503).json(healthResponseSchema.parse({ status: ready ? 'ok' : 'degraded', checks: dependencies }));
  });
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: res.locals.requestId } });
  });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const code = status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
    const httpStatus = status === 400 || status === 413 ? status : 500;
    logger.error({ requestId: res.locals.requestId, code }, 'request failed');
    if (res.headersSent) return res.end();
    res.status(httpStatus).json({ error: {
      code, message: httpStatus === 500 ? 'Internal server error' : 'Invalid request body',
      requestId: res.locals.requestId,
    } });
  };
  app.use(errorHandler);
  return app;
}
