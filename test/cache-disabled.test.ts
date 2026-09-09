import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from '../src/config.ts';
import { createCache } from '../src/utils.ts';
import { startApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';

const stashPath = '/economy/stash/current/item/overview';

describe('an unusable cache expiration disables caching', () => {
  let warn: Mock<typeof console.warn>;

  beforeEach(() => {
    // every construction warns; keep the run quiet and assert on the calls
    warn = mock.method(console, 'warn', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('parses a non-numeric POE_CACHE_EXPIRATION_SEC as NaN', () => {
    const config = loadConfig({ POE_CACHE_EXPIRATION_SEC: 'abc' });

    assert.ok(Number.isNaN(config.cache.expirationSec));
  });

  for (const expirationSec of [NaN, 0, -1, Infinity]) {
    it(`never retains a value when the expiration is ${expirationSec}`, async () => {
      const cache = createCache(expirationSec);

      assert.equal(warn.mock.callCount(), 1);
      assert.match(
        String(warn.mock.calls[0].arguments[0]),
        /caching is disabled$/
      );

      let calls = 0;
      const fetcher = () => {
        calls += 1;

        return Promise.resolve(calls);
      };

      assert.deepEqual(await cache.cached('k', fetcher), {
        value: 1,
        hit: false
      });
      assert.deepEqual(await cache.cached('k', fetcher), {
        value: 2,
        hit: false
      });
      assert.equal(cache.size(), 0);

      // both are still safe to call
      cache.clear();
      cache.close();
    });
  }

  it('schedules no sweeper, which NaN would otherwise pin to the 1ms floor', () => {
    const intervals = mock.method(globalThis, 'setInterval');

    createCache(NaN);

    assert.equal(intervals.mock.callCount(), 0);

    // the same construction with a usable TTL does register one
    createCache(10).close();

    assert.equal(intervals.mock.callCount(), 1);
  });

  it('makes every HTTP request a miss', async () => {
    const upstream = await startUpstream({ status: 200, body: [{ ok: true }] });
    const app = await startApp({
      cache: { expirationSec: NaN },
      ninja: { baseUrl: upstream.baseUrl }
    });

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await app.get(`${stashPath}?league=Standard&type=Map`);

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-cache'), 'MISS');
      }

      assert.equal(upstream.count, 2);
    } finally {
      await app.close();
      await upstream.close();
    }
  });

  it('still collapses concurrent requests into one upstream call', async () => {
    const upstream = await startUpstream({ status: 200, body: [{ ok: true }] });
    const app = await startApp({
      cache: { expirationSec: NaN },
      ninja: { baseUrl: upstream.baseUrl }
    });
    const release = upstream.hold();

    try {
      const pending = Array.from({ length: 5 }, () =>
        app.get(`${stashPath}?league=Standard&type=Map`)
      );

      // the upstream has the first request and is holding it, so the entry is
      // in flight; the short grace lets the rest reach the handler too
      await upstream.waitFor(1);
      await delay(200);
      release();

      const responses = await Promise.all(pending);

      assert.equal(upstream.count, 1);

      for (const res of responses) {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-cache'), 'MISS');
      }
    } finally {
      await app.close();
      await upstream.close();
    }
  });
});
