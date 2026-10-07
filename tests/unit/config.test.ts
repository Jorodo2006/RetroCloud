import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../api/src/config.js';

const valid = {
  DATABASE_URL: 'mysql://local:example@localhost:3307/retro_cloud',
  STORAGE_ACCOUNT_NAME: 'retrocloud',
  STORAGE_ACCOUNT_KEY: 'YQ=='.repeat(16).replaceAll('=', 'A'),
  STORAGE_BLOB_ENDPOINT: 'http://localhost:10000/retrocloud',
  STORAGE_CONTAINER_SAVES: 'saves',
  STORAGE_CONTAINER_CAPTURES: 'captures',
};

describe('configuration', () => {
  it('parses defaults and numeric ports', () => {
    expect(loadConfig({ ...valid, PORT: '4000' }).PORT).toBe(4000);
    expect(loadConfig(valid).NODE_ENV).toBe('development');
  });
  it.each(['0', '65536', 'abc'])('rejects invalid port %s', PORT => {
    expect(() => loadConfig({ ...valid, PORT })).toThrow('PORT');
  });
  it('does not expose invalid credentials in validation errors', () => {
    const secret = 'private-key-that-must-not-appear';
    expect(() => loadConfig({ ...valid, DATABASE_URL: secret })).toThrow('DATABASE_URL');
    try { loadConfig({ ...valid, DATABASE_URL: secret }); } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
  it('rejects unhandled MySQL URL parameters', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: valid.DATABASE_URL + '?ssl=true' })).toThrow('DATABASE_URL');
  });
  it('requires different private containers', () => {
    expect(() => loadConfig({ ...valid, STORAGE_CONTAINER_CAPTURES: 'saves' })).toThrow('STORAGE_CONTAINER_CAPTURES');
  });
  it('requires HTTPS storage in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow('STORAGE_BLOB_ENDPOINT');
  });
});
