import { z } from 'zod';
import { idSchema } from './auth.js';

const timestamp = z.iso.datetime({ precision: 3 }).refine(value => Date.parse(value) >= Date.UTC(2000, 0, 1), 'Date must be in 2000 or later');
export const playSessionSchema = z.strictObject({
  clientSessionId: idSchema, gameId: idSchema, startedAt: timestamp,
  endedAt: timestamp.nullable().default(null),
  durationSeconds: z.number().int().min(0).max(4294967295).nullable().default(null),
}).superRefine((value, ctx) => {
  if ((value.endedAt === null) !== (value.durationSeconds === null)) {
    ctx.addIssue({ code: 'custom', message: 'End and duration must be supplied together' });
  }
  if (value.endedAt !== null && (Date.parse(value.endedAt) < Date.parse(value.startedAt)
    || (value.durationSeconds !== null && value.durationSeconds > Math.floor((Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000)))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid session interval or duration' });
  }
});
export const sessionQuerySchema = z.strictObject({
  deviceId: idSchema.optional(), gameId: idSchema.optional(),
  from: timestamp.optional(), to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).refine(value => !value.from || !value.to || value.from < value.to, 'from must precede to');
export type PlaySessionInput = z.infer<typeof playSessionSchema>;
export type SessionQuery = z.infer<typeof sessionQuerySchema>;
