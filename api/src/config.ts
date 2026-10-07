import path from 'node:path';
import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().refine(value => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === 'mysql:' && url.username.length > 0 &&
      url.password.length > 0 && url.pathname.length > 1 && !url.search;
  }, 'Use a MySQL URL with credentials, database and no query parameters'),
  STORAGE_ROOT: z.string().min(1).refine(value => path.isAbsolute(value) && !value.includes('\0'),
    'Use an absolute local storage directory'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Only field names: never print supplied values, URLs or secrets.
    throw new Error('Invalid configuration: ' + [...new Set(result.error.issues.map(issue => issue.path.join('.')))].join(', '));
  }
  return result.data;
}
