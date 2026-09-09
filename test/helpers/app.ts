import { once } from 'node:events';
import type { Server } from 'node:http';

import { createApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/types.ts';

export type ConfigOverrides = {
  cache?: Partial<AppConfig['cache']>;
  listen?: Partial<Omit<AppConfig['listen'], 'rateLimiter'>> & {
    rateLimiter?: Partial<AppConfig['listen']['rateLimiter']>;
  };
  ninja?: Partial<AppConfig['ninja']>;
};

export type TestResponse = {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
};

export type TestApp = {
  /** Origin of the running server, e.g. `http://127.0.0.1:53124`. */
  url: string;
  get(path: string, init?: RequestInit): Promise<TestResponse>;
  close(): Promise<void>;
};

/**
 * The baseline is deliberately permissive - a large reservoir and a long TTL -
 * so that a test only sees the limiter or an expiry when it asks for one.
 */
function buildConfig(overrides: ConfigOverrides): AppConfig {
  return {
    cache: {
      expirationSec: 900,
      ...overrides.cache
    },
    listen: {
      host: '127.0.0.1',
      port: 0,
      corsDomain: '*',
      trustProxy: false,
      ...overrides.listen,
      rateLimiter: {
        windowMs: 1000,
        limit: 1000,
        ...overrides.listen?.rateLimiter
      }
    },
    ninja: {
      baseUrl: 'http://127.0.0.1:1/poe1/api',
      timeoutMs: 10000,
      ...overrides.ninja
    }
  };
}

export async function startApp(
  overrides: ConfigOverrides = {}
): Promise<TestApp> {
  const app = createApp(buildConfig(overrides));
  const server: Server = app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('app did not bind a TCP port');
  }

  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    async get(path, init) {
      const response = await fetch(`${url}${path}`, init);
      const text = await response.text();
      const json = response.headers
        .get('content-type')
        ?.includes('application/json');

      return {
        status: response.status,
        headers: response.headers,
        text,
        body: json && text ? JSON.parse(text) : text
      };
    },
    async close() {
      await (app.locals.dispose as () => Promise<void>)();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  };
}
