import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { request as requestPrototype } from 'express';

import type { AppConfig } from '../src/types.ts';
import { startApp } from './helpers/app.ts';
import type { TestApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

const stashPath = '/economy/stash/current/item/overview';
const windowMs = 1000;

describe('per-IP rate limiting', () => {
  let upstream: FakeUpstream;

  before(async () => {
    upstream = await startUpstream({ status: 200, body: [{ ok: true }] });
  });

  after(async () => {
    await upstream.close();
  });

  /**
   * Every test gets its own app so it starts with a full reservoir. Caching is
   * left at the default, which does not matter - the limiter runs ahead of the
   * routes, so a throttled request never reaches one.
   */
  async function appWith(
    rateLimiter: Partial<AppConfig['listen']['rateLimiter']>
  ): Promise<TestApp> {
    return startApp({
      listen: { rateLimiter },
      ninja: { baseUrl: upstream.baseUrl }
    });
  }

  it('serves up to the limit and then answers 429', async () => {
    const app = await appWith({ limit: 2, windowMs });

    try {
      upstream.requests.length = 0;

      const first = await app.get(`${stashPath}?league=Standard&type=Map`);
      const second = await app.get(`${stashPath}?league=Hardcore&type=Map`);

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);

      const third = await app.get(`${stashPath}?league=Standard&type=Beast`);

      assert.equal(third.status, 429);
      assert.deepEqual(third.body, { error: 'Too many requests' });
      assert.equal(
        third.headers.get('retry-after'),
        Math.ceil(windowMs / 1000).toString()
      );
    } finally {
      await app.close();
    }
  });

  it('never throttles /health', async () => {
    const app = await appWith({ limit: 1, windowMs });

    try {
      assert.equal((await app.get('/economy/leagues')).status, 200);
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        429
      );

      for (let attempt = 0; attempt < 3; attempt++) {
        const health = await app.get('/health');

        assert.equal(health.status, 200);
        assert.deepEqual(health.body, { status: 'ok' });
      }
    } finally {
      await app.close();
    }
  });

  it('refills the reservoir after the window elapses', async () => {
    const app = await appWith({ limit: 1, windowMs });

    try {
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        200
      );
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        429
      );

      // delay by twice the window to ensure it has elapsed
      await delay(windowMs * 2);

      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        200
      );
    } finally {
      await app.close();
    }
  });

  it('meters each client address separately', async () => {
    const app = await startApp({
      listen: { trustProxy: true, rateLimiter: { limit: 1, windowMs } },
      ninja: { baseUrl: upstream.baseUrl }
    });
    const request = (ip: string) =>
      app.get(`${stashPath}?league=Standard&type=Map`, {
        headers: { 'x-forwarded-for': ip }
      });

    try {
      assert.equal((await request('1.2.3.4')).status, 200);
      assert.equal((await request('1.2.3.4')).status, 429);

      // a different address still has its own budget
      assert.equal((await request('5.6.7.8')).status, 200);
      assert.equal((await request('5.6.7.8')).status, 429);
    } finally {
      await app.close();
    }
  });

  it('meters requests without a resolvable address under one bucket', async () => {
    // proxy-addr leaves req.ip undefined when the socket has no remote address,
    // which a real connection never reproduces
    mock.getter(requestPrototype, 'ip', () => undefined);

    const app = await appWith({ limit: 1, windowMs });

    try {
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        200
      );
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Map`)).status,
        429
      );
    } finally {
      await app.close();
      mock.restoreAll();
    }
  });

  it('throttles before routing, so 404s and 400s are metered too', async () => {
    const app = await appWith({ limit: 1, windowMs });

    try {
      // a validation failure spends a token
      assert.equal(
        (await app.get(`${stashPath}?league=Standard&type=Bogus`)).status,
        400
      );
      // so the next request is throttled even though it is a 404 route
      assert.equal((await app.get('/nope')).status, 429);
    } finally {
      await app.close();
    }
  });

  it('does not reach the upstream when throttled', async () => {
    const app = await appWith({ limit: 1, windowMs });

    try {
      upstream.requests.length = 0;

      assert.equal(
        (await app.get(`${stashPath}?league=Mercenaries&type=Map`)).status,
        200
      );
      assert.equal(
        (await app.get(`${stashPath}?league=Mercenaries HC&type=Map`)).status,
        429
      );

      assert.equal(upstream.count, 1);
    } finally {
      await app.close();
    }
  });
});
