import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { PrismaClient } from './generated/prisma/client.js';
import type { Config } from './config.js';

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

export function createStorage(config: Config) {
  return new BlobServiceClient(
    config.STORAGE_BLOB_ENDPOINT,
    new StorageSharedKeyCredential(config.STORAGE_ACCOUNT_NAME, config.STORAGE_ACCOUNT_KEY),
    { retryOptions: { maxTries: 1, tryTimeoutInMs: 3000 } },
  );
}

export function createInfrastructure(config: Config) {
  const database = createDatabase(config);
  const storage = createStorage(config);
  return {
    database,
    storage,
    checks: {
      database: async () => { await database.$queryRaw`SELECT 1`; },
      storage: async () => {
        await Promise.all([
          storage.getContainerClient(config.STORAGE_CONTAINER_SAVES).getProperties(),
          storage.getContainerClient(config.STORAGE_CONTAINER_CAPTURES).getProperties(),
        ]);
      },
    },
    close: () => database.$disconnect(),
  };
}
