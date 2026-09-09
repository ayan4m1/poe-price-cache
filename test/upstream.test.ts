import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { startApp } from './helpers/app.ts';
import type { ConfigOverrides, TestApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

const path = '/economy/stash/current/item/overview?league=Standard&type=Map';

describe('upstream failures', () => {
  let upstream: FakeUpstream;
  let app: TestApp;

  beforeEach(async () => {
    upstream = await startUpstream();
    // a fresh pair per test, so no successful response is ever cached across
    // the error cases
    app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });
  });

  afterEach(async () => {
    await app.close();
    await upstream.close();
    mock.restoreAll();
  });

  async function withConfig(overrides: ConfigOverrides) {
    await app.close();
    app = await startApp({
      ...overrides,
      ninja: { baseUrl: upstream.baseUrl, ...overrides.ninja }
    });
  }

  for (const status of [404, 500, 502, 503]) {
    it(`passes a ${status} from poe.ninja through`, async () => {
      upstream.respondWith({ status, body: { message: 'nope' } });

      const res = await app.get(path);

      assert.equal(res.status, status);
      assert.match(
        res.headers.get('content-type') ?? '',
        /^application\/json\b/
      );
      assert.deepEqual(res.body, {
        error: `poe.ninja responded ${status} for /poe1/api/economy/stash/current/item/overview?league=Standard&type=Map`
      });
    });
  }

  it('passes a 429 from poe.ninja through without a Retry-After', async () => {
    upstream.respondWith({ status: 429 });

    const res = await app.get(path);

    assert.equal(res.status, 429);
    // distinguishes an upstream 429 from our own limiter's, which does set it
    assert.equal(res.headers.get('retry-after'), null);
    assert.match(
      (res.body as { error: string }).error,
      /^poe\.ninja responded 429 /
    );
  });

  it('answers 502 when the upstream hangs up', async () => {
    upstream.respondWith({ hangUp: true });

    const res = await app.get(path);

    assert.equal(res.status, 502);
    assert.match(
      (res.body as { error: string }).error,
      /^could not reach poe\.ninja: /
    );
  });

  it('answers 502 when the upstream is unreachable', async () => {
    await withConfig({ ninja: { baseUrl: 'http://127.0.0.1:1/poe1/api' } });

    const res = await app.get(path);

    assert.equal(res.status, 502);
    assert.match(
      (res.body as { error: string }).error,
      /^could not reach poe\.ninja: /
    );
  });

  it('answers 502 when the upstream exceeds the timeout', async () => {
    await withConfig({ ninja: { timeoutMs: 100 } });
    upstream.respondWith({ status: 200, body: [], delayMs: 500 });

    const res = await app.get(path);

    assert.equal(res.status, 502);
    assert.match(
      (res.body as { error: string }).error,
      /^could not reach poe\.ninja: .*(timed out|aborted)/i
    );
  });

  it('answers 500 when the upstream returns malformed JSON', async () => {
    const errors = mock.method(console, 'error', () => {});

    upstream.respondWith({ status: 200, raw: '{"not":' });

    const res = await app.get(path);

    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'Internal server error' });
    // a parse failure is not an UpstreamError, so it is logged
    assert.equal(errors.mock.callCount(), 1);
  });

  it('does not cache a failed response', async () => {
    upstream.respondOnceWith({ status: 503 });
    upstream.respondWith({ status: 200, body: [{ ok: true }] });

    const failed = await app.get(path);

    assert.equal(failed.status, 503);

    const retried = await app.get(path);

    assert.equal(retried.status, 200);
    assert.deepEqual(retried.body, [{ ok: true }]);
    assert.equal(retried.headers.get('x-cache'), 'MISS');
    assert.equal(upstream.count, 2);
  });
});
