import assert from 'node:assert/strict';
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock
} from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createCache } from '../src/utils.ts';
import { startApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

const stashPath = '/economy/stash/current/item/overview';
const exchangePath = '/economy/exchange/current/overview';

describe('cache behaviour over HTTP', () => {
  let upstream: FakeUpstream;

  before(async () => {
    upstream = await startUpstream({ status: 200, body: [{ ok: true }] });
  });

  after(async () => {
    await upstream.close();
  });

  beforeEach(() => {
    upstream.requests.length = 0;
    upstream.respondWith({ status: 200, body: [{ ok: true }] });
  });

  it('serves a repeat request from the cache', async () => {
    const app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });

    try {
      const first = await app.get(`${stashPath}?league=Standard&type=Map`);

      assert.equal(first.status, 200);
      assert.equal(first.headers.get('x-cache'), 'MISS');
      assert.equal(upstream.count, 1);

      const second = await app.get(`${stashPath}?league=Standard&type=Map`);

      assert.equal(second.headers.get('x-cache'), 'HIT');
      assert.deepEqual(second.body, first.body);
      assert.equal(upstream.count, 1);
    } finally {
      await app.close();
    }
  });

  it('refetches once the expiration interval has elapsed', async () => {
    const app = await startApp({
      cache: { expirationSec: 1 },
      ninja: { baseUrl: upstream.baseUrl }
    });

    try {
      const first = await app.get(`${stashPath}?league=Standard&type=Map`);

      assert.equal(first.headers.get('x-cache'), 'MISS');
      assert.equal(upstream.count, 1);

      const cachedHit = await app.get(`${stashPath}?league=Standard&type=Map`);

      assert.equal(cachedHit.headers.get('x-cache'), 'HIT');
      assert.equal(upstream.count, 1);

      await delay(1100);

      const expired = await app.get(`${stashPath}?league=Standard&type=Map`);

      assert.equal(expired.headers.get('x-cache'), 'MISS');
      assert.equal(upstream.count, 2);
    } finally {
      await app.close();
    }
  });

  it('keys the cache on route, league and type', async () => {
    const app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });

    try {
      const requests = [
        `${stashPath}?league=Standard&type=Map`,
        `${stashPath}?league=Hardcore&type=Map`,
        `${stashPath}?league=Standard&type=Beast`,
        `${exchangePath}?league=Standard&type=Currency`
      ];

      for (const request of requests) {
        const res = await app.get(request);

        assert.equal(res.status, 200, request);
        assert.equal(res.headers.get('x-cache'), 'MISS', request);
      }

      assert.equal(upstream.count, requests.length);

      // and every one of them is now a hit
      for (const request of requests) {
        const res = await app.get(request);

        assert.equal(res.headers.get('x-cache'), 'HIT', request);
      }

      assert.equal(upstream.count, requests.length);
    } finally {
      await app.close();
    }
  });

  it('collapses concurrent misses into a single upstream call', async () => {
    const app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });
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
        assert.deepEqual(res.body, [{ ok: true }]);
        // followers awaiting someone else's fetch report a miss as well
        assert.equal(res.headers.get('x-cache'), 'MISS');
      }
    } finally {
      await app.close();
    }
  });
});

describe('createCache', () => {
  afterEach(() => {
    mock.timers.reset();
  });

  it('treats the expiry moment itself as a miss', async () => {
    mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });

    const cache = createCache(10);
    let calls = 0;
    const fetcher = () => {
      calls += 1;

      return Promise.resolve(calls);
    };

    assert.deepEqual(await cache.cached('k', fetcher), {
      value: 1,
      hit: false
    });

    mock.timers.tick(9999);
    assert.deepEqual(await cache.cached('k', fetcher), { value: 1, hit: true });

    // expiresAt is 10000 and the check is `expiresAt > now`, so 10000 expires
    mock.timers.tick(1);
    assert.deepEqual(await cache.cached('k', fetcher), {
      value: 2,
      hit: false
    });

    cache.close();
  });

  it('sweeps expired entries', async () => {
    mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });

    const cache = createCache(10);

    await cache.cached('k', () => Promise.resolve('v'));
    assert.equal(cache.size(), 1);

    mock.timers.tick(9999);
    assert.equal(cache.size(), 1, 'not swept before the interval fires');

    mock.timers.tick(1);
    assert.equal(cache.size(), 0);

    cache.close();
  });

  it('stops the sweeper on close', async () => {
    mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });

    const cache = createCache(10);

    await cache.cached('k', () => Promise.resolve('v'));
    cache.close();

    mock.timers.tick(60000);
    assert.equal(cache.size(), 1, 'a closed cache no longer sweeps');
  });

  it('shares one fetcher call between concurrent misses', async () => {
    const cache = createCache(900);

    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = async () => {
      calls += 1;
      await gate;

      return 'v';
    };

    // queued synchronously, so all five are in flight before any resolves
    const pending = Array.from({ length: 5 }, () => cache.cached('k', fetcher));

    release();

    const results = await Promise.all(pending);

    assert.equal(calls, 1);

    for (const result of results) {
      assert.equal(result.value, 'v');
      // followers awaiting someone else's fetch report a miss as well
      assert.equal(result.hit, false);
    }

    cache.close();
  });

  it('clears every entry on clear', async () => {
    const cache = createCache(900);

    await cache.cached('a', () => Promise.resolve(1));
    await cache.cached('b', () => Promise.resolve(2));
    assert.equal(cache.size(), 2);

    cache.clear();
    assert.equal(cache.size(), 0);

    cache.close();
  });
});
