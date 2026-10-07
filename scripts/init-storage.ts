import { loadConfig } from '../api/src/config.js';
import { createStorage } from '../api/src/infrastructure.js';
import { createLogger } from '../api/src/logger.js';

const logger = createLogger('info');
try {
  const config = loadConfig();
  const storage = createStorage(config);
  for (const name of [config.STORAGE_CONTAINER_SAVES, config.STORAGE_CONTAINER_CAPTURES]) {
    const container = storage.getContainerClient(name);
    await container.createIfNotExists();
    await container.setAccessPolicy(undefined);
    logger.info({ container: name }, 'Private storage container ready');
  }
} catch {
  logger.error('Storage initialization failed; check configuration and Azurite availability');
  process.exitCode = 1;
}
