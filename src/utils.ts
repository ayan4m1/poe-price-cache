import Bottleneck from 'bottleneck';
import { createRequire } from 'node:module';

import type {
  CacheEntry,
  CacheResult,
  ListenConfig,
  NinjaConfig
} from './types.ts';

function packageVersion(): string {
  try {
    const { version } = createRequire(import.meta.url)('../package.json') as {
      version: string;
    };

    return version;
  } catch {
    // the User-Agent is cosmetic, so never let a missing manifest halt startup
    return 'unknown';
  }
}

const userAgent = `poe-price-cache/${packageVersion()} (+https://github.com/ayan4m1/poe-price-cache)`;

/** Fallback bound on cached entries, shared by `loadConfig` and `createCache`. */
export const defaultCacheMaxEntries = 1000;

/**
 * Raised when poe.ninja cannot be reached or answers with a non-2xx status, so
 * that the Express error handler can reply with that status instead of a
 * generic 500. Transport failures carry a 502.
 *
 * `message` carries the diagnostic detail - the resolved upstream path and the
 * transport failure - and belongs in the server log only. `publicMessage` is
 * the sanitized form a client is allowed to see, so that the configured
 * upstream layout never leaks to a caller.
 */
export class UpstreamError extends Error {
  public readonly status: number;
  public readonly publicMessage: string;

  constructor(message: string, status: number, publicMessage: string) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export type Cache = {
  cached<T>(key: string, fetcher: () => Promise<T>): Promise<CacheResult<T>>;
  clear(): void;
  close(): void;
  size(): number;
};

/**
 * In-memory cache with a fixed TTL and a bounded entry count. Concurrent misses
 * for the same key share a single `fetcher` call.
 *
 * A non-numeric POE_CACHE_EXPIRATION_SEC parses to NaN, which would make every
 * entry expire immediately and schedule the sweeper at the 1ms floor, so a TTL
 * that is not a positive number disables caching outright.
 *
 * `maxEntries` bounds the key space. Route validation constrains the shape of a
 * league id but not how many distinct ones exist, so without this bound a
 * caller can mint unlimited keys and grow the store until the process runs out
 * of memory - the sweeper only drops entries that have already expired. Once
 * the store is full the least recently used entry is evicted. A bound that is
 * not a positive number falls back to the default rather than leaving the
 * store unbounded.
 */
export function createCache(
  expirationSec: number,
  maxEntries: number = defaultCacheMaxEntries
): Cache {
  const enabled = Number.isFinite(expirationSec) && expirationSec > 0;
  const bounded = Number.isFinite(maxEntries) && maxEntries >= 1;

  if (!enabled) {
    console.warn(
      `cache expiration "${expirationSec}" is not a positive number - caching is disabled`
    );
  }

  if (!bounded) {
    console.warn(
      `cache max entries "${maxEntries}" is not a positive number - falling back to ${defaultCacheMaxEntries}`
    );
  }

  const limit = bounded ? Math.floor(maxEntries) : defaultCacheMaxEntries;

  const store = new Map<string, CacheEntry<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();

  // drop expired entries so that stale keys do not sit on a slot until the
  // eviction below reclaims it
  const sweeper = enabled
    ? setInterval(() => {
        const now = Date.now();

        for (const [key, entry] of store) {
          if (entry.expiresAt <= now) {
            store.delete(key);
          }
        }
      }, expirationSec * 1000).unref()
    : null;

  return {
    async cached<T>(
      key: string,
      fetcher: () => Promise<T>
    ): Promise<CacheResult<T>> {
      const entry = store.get(key);

      if (entry && entry.expiresAt > Date.now()) {
        // reinsert so that the most recently read key is the last evicted
        store.delete(key);
        store.set(key, entry);

        return { value: entry.value as T, hit: true };
      }

      let pending = inFlight.get(key) as Promise<T> | undefined;

      if (!pending) {
        pending = fetcher()
          .then((value) => {
            // with caching disabled we still coalesce concurrent misses, we
            // just never retain the result
            if (enabled) {
              // an expired entry for this key still occupies its original slot,
              // so drop it first and let the write below append a fresh one
              store.delete(key);

              while (store.size >= limit) {
                const oldest = store.keys().next();

                if (oldest.done) {
                  break;
                }

                store.delete(oldest.value);
              }

              store.set(key, {
                value,
                expiresAt: Date.now() + expirationSec * 1000
              });
            }

            return value;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }

      return { value: await pending, hit: false };
    },
    clear() {
      store.clear();
    },
    close() {
      if (sweeper) {
        clearInterval(sweeper);
      }
    },
    size() {
      return store.size;
    }
  };
}

/**
 * Per-IP rate limiter. The reservoir refills `limit` tokens every `windowMs`,
 * and `highWater: 0` + OVERFLOW means anything that cannot run immediately is
 * dropped (rejecting with a BottleneckError) instead of being queued.
 */
export function createLimiters(
  config: ListenConfig['rateLimiter']
): Bottleneck.Group {
  return new Bottleneck.Group({
    reservoir: config.limit,
    reservoirRefreshAmount: config.limit,
    // Bottleneck requires this to be a multiple of 250ms
    reservoirRefreshInterval: Math.max(
      250,
      Math.ceil(config.windowMs / 250) * 250
    ),
    highWater: 0,
    strategy: Bottleneck.strategy.OVERFLOW,
    // how long an IP can sit idle before its limiter is garbage collected
    timeout: Math.max(config.windowMs * 4, 300000)
  });
}

export type NinjaClient = {
  fetch<T>(path: string, params?: Record<string, string>): Promise<T>;
};

/**
 * Performs GETs against the poe.ninja economy API.
 */
export function createNinjaClient(config: NinjaConfig): NinjaClient {
  return {
    async fetch<T>(path: string, params?: Record<string, string>): Promise<T> {
      const url = new URL(`${config.baseUrl}${path}`);

      for (const [name, value] of Object.entries(params ?? {})) {
        url.searchParams.set(name, value);
      }

      let response: Response;

      try {
        response = await fetch(url, {
          headers: {
            accept: 'application/json',
            'user-agent': userAgent
          },
          signal: AbortSignal.timeout(config.timeoutMs)
        });
      } catch (error) {
        // DNS failures, connection resets and the abort timeout all land here
        throw new UpstreamError(
          `could not reach poe.ninja: ${error instanceof Error ? error.message : String(error)}`,
          502,
          'could not reach poe.ninja'
        );
      }

      if (!response.ok) {
        throw new UpstreamError(
          `poe.ninja responded ${response.status} for ${url.pathname}${url.search}`,
          response.status,
          `poe.ninja responded ${response.status}`
        );
      }

      return (await response.json()) as T;
    }
  };
}
