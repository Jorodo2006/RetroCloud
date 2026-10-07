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
  STORAGE_ACCOUNT_NAME: z.string().regex(/^[a-z0-9]{3,24}$/),
  STORAGE_ACCOUNT_KEY: z.string().min(32).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  STORAGE_BLOB_ENDPOINT: z.string().url().refine(value => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)),
  STORAGE_CONTAINER_SAVES: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(63),
  STORAGE_CONTAINER_CAPTURES: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(63),
}).superRefine((value, ctx) => {
  if (value.STORAGE_CONTAINER_SAVES === value.STORAGE_CONTAINER_CAPTURES) {
    ctx.addIssue({ code: 'custom', path: ['STORAGE_CONTAINER_CAPTURES'], message: 'Use separate containers' });
  }
  if (value.NODE_ENV === 'production' && !value.STORAGE_BLOB_ENDPOINT.startsWith('https:')) {
    ctx.addIssue({ code: 'custom', path: ['STORAGE_BLOB_ENDPOINT'], message: 'HTTPS required in production' });
  }
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
