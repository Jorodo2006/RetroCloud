import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createInfrastructure } from './infrastructure.js';
import { createLogger } from './logger.js';

const bootstrapLogger = createLogger('info');
try {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const infrastructure = createInfrastructure(config);
  const server = createApp(logger, infrastructure.checks, { database: infrastructure.database, config }).listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT }, 'Retro Cloud API listening');
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger.info('Shutting down');
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      void infrastructure.close().then(() => {
        clearTimeout(timeout);
        process.exit(0);
      }).catch(() => process.exit(1));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', () => {
    logger.fatal('HTTP server failed to start');
    void infrastructure.close().finally(() => process.exit(1));
  });
} catch (error) {
  const detail = error instanceof Error && error.message.startsWith('Invalid configuration:')
    ? error.message : 'API initialization failed';
  bootstrapLogger.fatal({ detail }, 'Startup failed');
  process.exitCode = 1;
}
