import Bottleneck from 'bottleneck';
import { createRequire } from 'node:module';

import { cache, listen } from './config';
import { CacheEntry, CacheResult } from './types';

const baseUrl = 'https://poe.ninja/poe1/api';
const upstreamTimeoutMs = 10000;

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

/**
 * Raised when poe.ninja answers with a non-2xx status, so that the Express
 * error handler can translate it into a 502 rather than a generic 500.
 */
export class UpstreamError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

/**
 * Per-IP rate limiter. The reservoir refills `limit` tokens every `windowMs`,
 * and `highWater: 0` + OVERFLOW means anything that cannot run immediately is
 * dropped (rejecting with a BottleneckError) instead of being queued.
 */
export const limiters = new Bottleneck.Group({
  reservoir: listen.rateLimiter.limit,
  reservoirRefreshAmount: listen.rateLimiter.limit,
  // Bottleneck requires this to be a multiple of 250ms
  reservoirRefreshInterval: Math.max(
    250,
    Math.ceil(listen.rateLimiter.windowMs / 250) * 250
  ),
  highWater: 0,
  strategy: Bottleneck.strategy.OVERFLOW,
  // how long an IP can sit idle before its limiter is garbage collected
  timeout: Math.max(listen.rateLimiter.windowMs * 4, 300000)
});

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Reads `key` from the in-memory cache, falling back to `fetcher` on a miss.
 * Concurrent misses for the same key share a single `fetcher` call.
 */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  const entry = store.get(key);

  if (entry && entry.expiresAt > Date.now()) {
    return { value: entry.value as T, hit: true };
  }

  let pending = inFlight.get(key) as Promise<T> | undefined;

  if (!pending) {
    pending = fetcher()
      .then((value) => {
        store.set(key, {
          value,
          expiresAt: Date.now() + cache.expirationSec * 1000
        });

        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  return { value: await pending, hit: false };
}

// drop expired entries so the cache does not grow without bound
setInterval(() => {
  const now = Date.now();

  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}, cache.expirationSec * 1000).unref();

/**
 * Performs a GET against the poe.ninja PoE 1 economy API.
 */
export async function fetchNinja<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);

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
      signal: AbortSignal.timeout(upstreamTimeoutMs)
    });
  } catch (error) {
    // DNS failures, connection resets and the abort timeout all land here
    throw new UpstreamError(
      `could not reach poe.ninja: ${error instanceof Error ? error.message : String(error)}`,
      502
    );
  }

  if (!response.ok) {
    throw new UpstreamError(
      `poe.ninja responded ${response.status} for ${url.pathname}${url.search}`,
      response.status
    );
  }

  return (await response.json()) as T;
}
