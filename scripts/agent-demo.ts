import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadAgentConfig, libraryConfigSchema } from '../agent/src/config.js';
import { scanLibrary } from '../agent/src/scanner.js';

const root = fileURLToPath(new URL('../data/agent-demo/roms', import.meta.url));
const file = path.join(root, 'snes', 'Synthetic example.sfc');
const contents = 'Retro Cloud synthetic scanner fixture. This is not a playable ROM.\n';
await mkdir(path.dirname(file), { recursive: true });
try { await writeFile(file, contents, { flag: 'wx' }); }
catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  if (await readFile(file, 'utf8') !== contents) throw new Error('Demo file already exists with different contents; left unchanged');
}
const result = await scanLibrary(loadAgentConfig({ AGENT_ROMS_ROOT: root }),
  libraryConfigSchema.parse({ roots: [{ directory: 'snes', consoleSlug: 'snes', extensions: ['.sfc'] }] }));
console.log(JSON.stringify({ ...result.stats, networkRequests: 0, message: 'Synthetic scan completed. No account or API connection used.' }));
