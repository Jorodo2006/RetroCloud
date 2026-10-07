import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client.js';
import type { Config } from './config.js';
import { createStorage } from './local-storage.js';

export { createStorage } from './local-storage.js';

export function createDatabase(config: Pick<Config, 'DATABASE_URL'>) {
  const url = new URL(config.DATABASE_URL);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: 5,
    connectTimeout: 3000,
    acquireTimeout: 3000,
    socketTimeout: 5000,
    timezone: '+00:00',
  });
  return new PrismaClient({ adapter });
}

export function createInfrastructure(config: Config) {
  const database = createDatabase(config);
  const storage = createStorage(config);
  return {
    database,
    storage,
    checks: {
      database: async () => { await database.$queryRaw`SELECT 1`; },
      storage: () => storage.check(),
    },
    close: () => database.$disconnect(),
  };
}
