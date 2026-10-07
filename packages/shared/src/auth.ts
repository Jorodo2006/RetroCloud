import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/);
export const registerSchema = z.strictObject({
  email, password: z.string().min(12).max(128), displayName: name,
});
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const deviceSchema = z.strictObject({ name });
export const idSchema = z.uuid();
export const emptyBodySchema = z.strictObject({});
export type Registration = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
