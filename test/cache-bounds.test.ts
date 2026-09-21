import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';

import { startApp } from './helpers/app.ts';
import type { TestApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';
import { defaultCacheMaxEntries, createCache } from '../src/utils.ts';

const stashPath = '/economy/stash/current/item/overview';

/** Resolves to `key`, and records that the fetcher actually ran. */
function fetcherFor(key: string, calls: string[]) {
  return () => {
    calls.push(key);

    return Promise.resolve(key);
  };
}

describe('cache entry bound', () => {
  describe('createCache', () => {
    it('evicts the oldest entry once the bound is reached', async () => {
      const cache = createCache(900, 3);
      const calls: string[] = [];

      try {
        for (const key of ['a', 'b', 'c']) {
          await cache.cached(key, fetcherFor(key, calls));
        }

        assert.equal(cache.size(), 3);

        await cache.cached('d', fetcherFor('d', calls));

        // still three, and "a" was the one that made room
        assert.equal(cache.size(), 3);

        const { hit } = await cache.cached('a', fetcherFor('a', calls));

        assert.equal(hit, false);
        assert.deepEqual(calls, ['a', 'b', 'c', 'd', 'a']);
      } finally {
        cache.close();
      }
    });

    it('evicts by least recent use, not by insertion order', async () => {
      const cache = createCache(900, 3);
      const calls: string[] = [];

      try {
        for (const key of ['a', 'b', 'c']) {
          await cache.cached(key, fetcherFor(key, calls));
        }

        // reading "a" makes "b" the least recently used
        const reread = await cache.cached('a', fetcherFor('a', calls));

        assert.equal(reread.hit, true);

        await cache.cached('d', fetcherFor('d', calls));

        assert.equal(
          (await cache.cached('a', fetcherFor('a', calls))).hit,
          true
        );
        assert.equal(
          (await cache.cached('b', fetcherFor('b', calls))).hit,
          false
        );
      } finally {
        cache.close();
      }
    });

    it('holds the bound against an unbounded key space', async () => {
      const cache = createCache(900, 5);
      const calls: string[] = [];

      try {
        for (let i = 0; i < 500; i++) {
          await cache.cached(`league-${i}`, fetcherFor(`league-${i}`, calls));
          assert.ok(
            cache.size() <= 5,
            `store grew to ${cache.size()} at key ${i}`
          );
        }

        assert.equal(cache.size(), 5);
      } finally {
        cache.close();
      }
    });

    it('reuses a slot when an expired key is fetched again', async () => {
      // 10ms TTL, so the entry is stale by the time it is asked for again
      const cache = createCache(0.01, 3);
      const calls: string[] = [];

      try {
        await cache.cached('a', fetcherFor('a', calls));
        await new Promise((resolve) => setTimeout(resolve, 25));

        const refetched = await cache.cached('a', fetcherFor('a', calls));

        assert.equal(refetched.hit, false);
        // the stale entry was replaced rather than occupying a second slot
        assert.equal(cache.size(), 1);
      } finally {
        cache.close();
      }
    });

    it('falls back to the default bound when the bound is unusable', async () => {
      const warn = mock.method(console, 'warn', () => {});
      const cache = createCache(900, NaN);
      const calls: string[] = [];

      try {
        for (const key of ['a', 'b']) {
          await cache.cached(key, fetcherFor(key, calls));
        }

        // a zero or NaN bound must not silently disable caching outright, nor
        // leave the store unbounded
        assert.equal(cache.size(), 2);
        assert.equal(warn.mock.callCount(), 1);
        assert.match(
          String(warn.mock.calls[0]?.arguments[0]),
          new RegExp(`falling back to ${defaultCacheMaxEntries}`)
        );
      } finally {
        cache.close();
        mock.restoreAll();
      }
    });
  });

  describe('over HTTP', () => {
    let upstream: FakeUpstream;
    let app: TestApp;

    before(async () => {
      upstream = await startUpstream({ status: 200, body: [{ ok: true }] });
      app = await startApp({
        cache: { maxEntries: 5 },
        ninja: { baseUrl: upstream.baseUrl }
      });
    });

    after(async () => {
      await app.close();
      await upstream.close();
    });

    it('bounds the store however many distinct leagues are requested', async () => {
      const get = (league: string) =>
        app.get(`${stashPath}?league=${league}&type=Map`);

      // every one of these passes the league pattern, so validation alone puts
      // no ceiling on the number of keys a caller can mint
      for (let i = 0; i < 10; i++) {
        const res = await get(`League${i}`);

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-cache'), 'MISS');
      }

      // the five most recent survive, everything older was evicted
      assert.equal((await get('League9')).headers.get('x-cache'), 'HIT');
      assert.equal((await get('League0')).headers.get('x-cache'), 'MISS');
    });
  });
});
