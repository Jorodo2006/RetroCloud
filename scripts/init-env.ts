import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const localPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const output = template
  .replaceAll('__JWT_SECRET__', randomBytes(32).toString('hex'))
  .replaceAll('__MYSQL_PASSWORD__', randomBytes(24).toString('hex'))
  .replaceAll('__MYSQL_ROOT_PASSWORD__', randomBytes(24).toString('hex'))
  .replaceAll('__STORAGE_ROOT__', localPath('../data/storage'))
  .replaceAll('__AGENT_ROMS_ROOT__', localPath('../data/roms'))
  .replaceAll('__AGENT_STATE_ROOT__', localPath('../data/agent'))
  .replaceAll('__AGENT_LIBRARY_CONFIG__', localPath('../agent/library.example.json'));
const file = new URL('../.env', import.meta.url);
try {
  await writeFile(file, output, { flag: 'wx', mode: 0o600 });
  console.log('.env creado con credenciales locales aleatorias. No se han mostrado secretos.');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  const current = await readFile(file, 'utf8');
  const existing = parse(current);
  const additions = output.split(/\r?\n/).filter(line => {
    const match = /^(JWT_SECRET|AGENT_[A-Z_]+)=/.exec(line);
    return match && !Object.hasOwn(existing, match[1]!);
  });
  if (additions.length) {
    await writeFile(file, current + '\n# Configuracion añadida; valores anteriores conservados\n' + additions.join('\n') + '\n', { mode: 0o600 });
    console.log('Variables nuevas añadidas a .env; valores existentes conservados. No se han mostrado secretos.');
  } else console.log('.env ya existe; no se ha modificado.');
}
