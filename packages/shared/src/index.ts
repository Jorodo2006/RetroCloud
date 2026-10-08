import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({ database: z.boolean(), storage: z.boolean() }).optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from './auth.js';
export * from './library.js';

export * from './sessions.js';
