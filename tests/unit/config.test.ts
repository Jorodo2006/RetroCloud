import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../api/src/config.js';

const valid = {
  JWT_SECRET: 'a'.repeat(64),
  DATABASE_URL: 'mysql://local:example@localhost:3307/retro_cloud',
  STORAGE_ROOT: path.resolve('data/storage'),
};

describe('configuration', () => {
  it('parses defaults and numeric ports without cloud credentials', () => {
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
  it.each(['', 'data/storage', 'bad\0path'])('rejects invalid storage root %s', STORAGE_ROOT => {
    expect(() => loadConfig({ ...valid, STORAGE_ROOT })).toThrow('STORAGE_ROOT');
  });
});


describe('authentication configuration', () => {
  it('requires a generated JWT secret and a valid exact origin', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    for (const APP_ORIGIN of ['not a URL', 'https://example.com/', 'https://example.com/path', 'ftp://example.com']) {
      expect(() => loadConfig({ ...valid, APP_ORIGIN })).toThrow('APP_ORIGIN');
    }
    expect(() => loadConfig({ ...valid, REGISTRATION_MODE: 'anything' })).toThrow('REGISTRATION_MODE');
    expect(loadConfig(valid).REGISTRATION_MODE).toBe('first-user');
  });
  it('requires HTTPS and secure cookies in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow('COOKIE_SECURE');
    expect(loadConfig({ ...valid, NODE_ENV: 'production', APP_ORIGIN: 'https://retro.example', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });
});
