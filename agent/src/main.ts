import { setTimeout as delay } from 'node:timers/promises';
import { pino } from 'pino';
import { loadAgentConfig, loadLibraryConfig, credentials } from './config.js';
import { scanLibrary } from './scanner.js';
import { AgentState } from './state.js';
import { ApiClient } from './client.js';
import { flushQueue } from './sync.js';
import { AgentError, errorCode } from './errors.js';

let logger = pino({ level: 'info' });
let state: AgentState | undefined;
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const config = loadAgentConfig();
  logger = pino({ level: config.LOG_LEVEL, redact: ['apiKey', 'AGENT_API_KEY', 'headers', 'password'] });
  const command = process.argv[2] ?? 'run';
  if (process.argv.length > 3 || !['scan', 'once', 'run', 'sync', 'status', 'retry'].includes(command)) {
    throw new AgentError('AGENT_INVALID_COMMAND');
  }
  const scan = async () => {
    const mapping = await loadLibraryConfig(config.AGENT_LIBRARY_CONFIG);
    return scanLibrary(config, mapping, state, controller.signal);
  };
  if (command === 'scan') {
    const result = await scan();
    logger.info(result.stats, 'Scan completed; no data sent');
  } else {
    const auth = credentials(config);
    state = await AgentState.open(config.AGENT_STATE_ROOT, { apiUrl: config.AGENT_API_URL, deviceId: auth.deviceId });
    const client = new ApiClient(config.AGENT_API_URL, auth.apiKey, auth.deviceId, config.AGENT_REQUEST_TIMEOUT_SECONDS * 1000);
    if (command === 'status') logger.info(state.status(), 'Agent queue status');
    else if (command === 'retry') { state.retry(); logger.info(state.status(), 'Deferred and blocked jobs are ready to retry'); }
    else {
      let nextScan = 0;
      do {
        if (command !== 'sync' && Date.now() >= nextScan) {
          try {
            const result = await scan();
            state.recordScan(result.observations, result.items);
            logger.info(result.stats, 'Library scan committed');
          } catch (error) {
            if (controller.signal.aborted) break;
            logger.error({ code: errorCode(error) }, 'Scan failed; existing queue preserved');
            if (command === 'once') process.exitCode = 1;
          }
          nextScan = Date.now() + config.AGENT_SCAN_INTERVAL_SECONDS * 1000;
        }
        if (controller.signal.aborted) break;
        const result = await flushQueue(state, client, controller.signal);
        if (command !== 'run' || result.sent || result.newlyBlocked || result.deferred) logger.info(result, 'Library synchronization checked');
        if (command !== 'run') {
          if (!process.exitCode && (result.pending || result.blocked)) process.exitCode = 2;
          break;
        }
        try { await delay(5000, undefined, { signal: controller.signal }); }
        catch (error) { if (!controller.signal.aborted) throw error; }
      } while (!controller.signal.aborted);
    }
  }
} catch (error) {
  if (!controller.signal.aborted) {
    logger.error({ code: errorCode(error) }, 'Agent stopped');
    process.exitCode = 1;
  }
} finally {
  state?.close();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
