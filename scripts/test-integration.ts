import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Never run destructive registration/concurrency fixtures against the user's database.
const inDocker = process.argv.includes('--docker');
const database = 'retro_test_' + randomBytes(6).toString('hex');
const username = process.env.MYSQL_USER;
if (!username || !/^[a-zA-Z0-9_]{1,32}$/.test(username) || !process.env.DATABASE_URL) {
  throw new Error('Local integration tests require MYSQL_USER and DATABASE_URL in .env');
}
function mysql(sql: string) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'mysql', 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root'], { input: sql, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('Could not prepare/clean isolated MySQL database; check Docker Desktop and compose mysql');
}
function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = inDocker
    ? spawnSync('docker', ['compose', 'run', '--rm', '--no-deps', '-T',
      '-e', 'DATABASE_URL', '-e', 'STORAGE_ROOT', '-e', 'JWT_SECRET', '-e', 'NODE_ENV', '-e', 'RETRO_TEST_ISOLATED',
      'api', 'node', script, ...args], { env, stdio: 'inherit' })
    : spawnSync(process.execPath, [script, ...args], { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Integration command failed: ' + path.basename(script));
}
let granted = false;
const storage = await mkdtemp(path.join(tmpdir(), 'retro-cloud-test-'));
try {
  mysql('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n'
    + 'GRANT ALL PRIVILEGES ON `' + database + '`.* TO ' + "'" + username + "'@'%';");
  granted = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + database;
  if (inDocker) { url.hostname = 'mysql'; url.port = '3306'; }
  const env = { ...process.env, DATABASE_URL: url.toString(), STORAGE_ROOT: inDocker ? '/tmp/' + database : storage,
    JWT_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'test', RETRO_TEST_ISOLATED: '1' };
  run('node_modules/prisma/build/index.js', ['migrate', 'deploy'], env);
  run('node_modules/vitest/vitest.mjs', ['run', '--config', 'vitest.integration.config.ts', '--configLoader', 'native', '--no-cache'], env);
} catch {
  console.error('Integration tests failed. The temporary database is being removed; application data was not used.');
  process.exitCode = 1;
} finally {
  try { mysql('DROP DATABASE IF EXISTS `' + database + '`;'); }
  catch { console.error('Temporary database cleanup failed: ' + database); process.exitCode = 1; }
  if (granted) {
    try { mysql('REVOKE ALL PRIVILEGES ON `' + database + '`.* FROM ' + "'" + username + "'@'%';"); }
    catch { console.error('Temporary database grant cleanup failed'); process.exitCode = 1; }
  }
  const resolved = path.resolve(storage);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('retro-cloud-test-')) {
    throw new Error('Refusing unexpected temporary directory cleanup');
  }
  await rm(resolved, { recursive: true, force: true });
}
