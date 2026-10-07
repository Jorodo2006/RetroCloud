import { pino } from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]',
        'password', 'passwordHash', 'apiKey', 'DATABASE_URL'],
      censor: '[REDACTED]',
    },
  });
}
