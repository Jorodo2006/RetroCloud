import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../api/src/app.js';
import { createLogger } from '../../api/src/logger.js';

const ok = async () => {};
const fail = async () => { throw new Error('secret-db-password'); };
const logger = createLogger('silent');

describe('HTTP health and errors', () => {
  it('liveness works when infrastructure is unavailable', async () => {
    const response = await request(createApp(logger, { database: fail, storage: fail })).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('readiness verifies both dependencies', async () => {
    const response = await request(createApp(logger, { database: ok, storage: ok })).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.checks).toEqual({ database: true, storage: true });
  });
  it.each([
    { database: fail, storage: ok }, { database: ok, storage: fail },
  ])('reports unavailable infrastructure without exposing errors', async checks => {
    const response = await request(createApp(logger, checks)).get('/health/ready');
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('returns a consistent 404', async () => {
    const response = await request(createApp(logger, { database: ok, storage: ok })).get('/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
  it('rejects malformed JSON without echoing input', async () => {
    const response = await request(createApp(logger, { database: ok, storage: ok }))
      .post('/unknown').set('Content-Type', 'application/json').send('{"secret":');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('limits request body size', async () => {
    const response = await request(createApp(logger, { database: ok, storage: ok }))
      .post('/unknown').send({ data: 'x'.repeat(40000) });
    expect(response.status).toBe(413);
  });
});
