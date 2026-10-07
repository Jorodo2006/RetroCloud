import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'db/schema.prisma',
  migrations: { path: 'db/migrations' },
  // Generate/validate/build do not require credentials or a live database.
  datasource: { url: process.env.DATABASE_URL ?? 'mysql://127.0.0.1:3306/retro_cloud' },
});
