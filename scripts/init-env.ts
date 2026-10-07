import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const output = template
  .replaceAll('__MYSQL_PASSWORD__', randomBytes(24).toString('hex'))
  .replaceAll('__MYSQL_ROOT_PASSWORD__', randomBytes(24).toString('hex'))
  .replaceAll('__STORAGE_ROOT__', fileURLToPath(new URL('../data/storage', import.meta.url)).replaceAll('\\', '/'));

try {
  await writeFile(new URL('../.env', import.meta.url), output, { flag: 'wx', mode: 0o600 });
  console.log('.env creado con credenciales locales aleatorias. No se han mostrado secretos.');
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
    console.log('.env ya existe; no se ha modificado.');
  } else throw error;
}
