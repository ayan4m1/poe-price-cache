import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { startApp } from './helpers/app.ts';
import type { TestApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

describe('baseline routes', () => {
  let upstream: FakeUpstream;
  let app: TestApp;

  before(async () => {
    upstream = await startUpstream();
    app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });
  });

  after(async () => {
    await app.close();
    await upstream.close();
  });

  beforeEach(() => {
    upstream.requests.length = 0;
    upstream.respondWith({ status: 200, body: [] });
  });

  it('answers /health without touching the upstream', async () => {
    const res = await app.get('/health');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
    assert.equal(upstream.count, 0);
  });

  it('does not advertise x-powered-by', async () => {
    const res = await app.get('/health');

    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('answers unknown paths with JSON 404', async () => {
    const res = await app.get('/nope');

    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.deepEqual(res.body, { error: 'Not found' });
    assert.equal(upstream.count, 0);
  });

  it('proxies and caches /economy/leagues', async () => {
    upstream.respondWith({ status: 200, body: [{ id: 'Standard' }] });

    const first = await app.get('/economy/leagues');

    assert.equal(first.status, 200);
    assert.deepEqual(first.body, [{ id: 'Standard' }]);
    assert.equal(first.headers.get('x-cache'), 'MISS');

    const second = await app.get('/economy/leagues');

    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.deepEqual(second.body, first.body);
    assert.equal(upstream.count, 1);
    assert.equal(upstream.requests[0].path, '/poe1/api/economy/leagues');
  });

  it('sends an accept header and an identifying user-agent upstream', async () => {
    // a fresh app so the shared instance's cached leagues entry cannot answer
    const fresh = await startApp({ ninja: { baseUrl: upstream.baseUrl } });

    await fresh.get('/economy/leagues');
    await fresh.close();

    assert.equal(upstream.count, 1);

    const { headers } = upstream.requests[0];

    assert.equal(headers.accept, 'application/json');
    assert.match(headers['user-agent'] ?? '', /^poe-price-cache\/\S+ \(\+/);
  });

  it('reflects the configured cors origin', async () => {
    const wildcard = await app.get('/health');

    assert.equal(wildcard.headers.get('access-control-allow-origin'), '*');

    const scoped = await startApp({
      listen: { corsDomain: 'https://example.com' },
      ninja: { baseUrl: upstream.baseUrl }
    });
    const res = await scoped.get('/health');

    await scoped.close();

    assert.equal(
      res.headers.get('access-control-allow-origin'),
      'https://example.com'
    );
  });
});
