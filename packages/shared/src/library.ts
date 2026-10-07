import { z } from 'zod';
import { idSchema } from './auth.js';

export const consoleSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const libraryItemSchema = z.strictObject({
  consoleSlug: consoleSlugSchema,
  title: z.string().trim().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/),
  hashAlgorithm: z.literal('SHA256'),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  // Decimal strings avoid rounding BIGINT values in JSON.
  sizeBytes: z.string().regex(/^[1-9][0-9]{0,19}$/)
    .refine(value => BigInt(value) <= 18446744073709551615n, 'Size exceeds uint64'),
});
export const librarySyncSchema = z.strictObject({ items: z.array(libraryItemSchema).min(1).max(50) });
export const libraryQuerySchema = z.strictObject({
  deviceId: idSchema.optional(), consoleSlug: consoleSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type LibrarySync = z.infer<typeof librarySyncSchema>;
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
