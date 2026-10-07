import { loadConfig } from '../api/src/config.js';
import { createStorage } from '../api/src/local-storage.js';
import { createLogger } from '../api/src/logger.js';

const logger = createLogger('info');
try {
  const storage = createStorage(loadConfig());
  await storage.initialize();
  await storage.check();
  logger.info('Local storage ready: saves and captures');
} catch {
  logger.error('Local storage initialization failed; check STORAGE_ROOT and directory permissions');
  process.exitCode = 1;
}
