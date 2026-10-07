import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { consoleSlugSchema } from '@retro-cloud/shared';
import { AgentError } from './errors.js';

const absolute = z.string().min(1).refine(value => path.isAbsolute(value) && !value.includes('\0'));
const optionalValue = (schema: z.ZodString) => z.preprocess(value => value === '' ? undefined : value, schema.optional());
export const agentConfigSchema = z.object({
  AGENT_API_URL: z.string().url().refine(value => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  }).default('http://localhost:3000').transform(value => new URL(value).origin),
  AGENT_API_KEY: optionalValue(z.string().regex(/^rcd_[A-Za-z0-9_-]{43}$/)),
  AGENT_DEVICE_ID: optionalValue(z.string().uuid()),
  AGENT_ROMS_ROOT: absolute.default(fileURLToPath(new URL('../../data/roms', import.meta.url))),
  AGENT_STATE_ROOT: absolute.default(fileURLToPath(new URL('../../data/agent', import.meta.url))),
  AGENT_LIBRARY_CONFIG: z.string().min(1).default(fileURLToPath(new URL('../library.example.json', import.meta.url))),
  AGENT_SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(86400).default(300),
  AGENT_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(15),
  AGENT_MAX_FILES: z.coerce.number().int().min(1).max(1000000).default(100000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const directory = z.string().min(1).max(255).refine(value =>
  !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
  value.split(/[\\/]/).every(part => part !== '..' && part !== '.' && part.length > 0) &&
  !/[\x00-\x1f:*?"<>|]/.test(value));
export const libraryConfigSchema = z.strictObject({
  roots: z.array(z.strictObject({
    directory, consoleSlug: consoleSlugSchema,
    extensions: z.array(z.string().regex(/^\.[a-z0-9]{1,12}$/)).min(1).max(30),
  })).min(1).max(100),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type LibraryConfig = z.infer<typeof libraryConfigSchema>;
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = agentConfigSchema.safeParse(env);
  if (!parsed.success) throw new AgentError('AGENT_CONFIG_INVALID');
  return parsed.data;
}
export async function loadLibraryConfig(file: string): Promise<LibraryConfig> {
  try {
    const content = await readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 65536) throw new Error();
    return libraryConfigSchema.parse(JSON.parse(content));
  } catch { throw new AgentError('LIBRARY_CONFIG_INVALID'); }
}
export function credentials(config: AgentConfig): { apiKey: string; deviceId: string } {
  if (!config.AGENT_API_KEY || !config.AGENT_DEVICE_ID) throw new AgentError('AGENT_CREDENTIALS_REQUIRED');
  return { apiKey: config.AGENT_API_KEY, deviceId: config.AGENT_DEVICE_ID };
}
