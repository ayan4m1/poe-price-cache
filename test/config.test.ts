import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Mock } from 'node:test';

import { loadConfig } from '../src/config.ts';

const managedKeys = [
  'POE_CACHE_EXPIRATION_SEC',
  'POE_WEB_HOST',
  'POE_WEB_PORT',
  'POE_WEB_CORS_DOMAIN',
  'POE_WEB_TRUST_PROXY',
  'POE_WEB_LIMITER_WINDOW_MS',
  'POE_WEB_LIMITER_LIMIT',
  'POE_NINJA_BASE_URL',
  'POE_NINJA_TIMEOUT_MS'
];

const defaults = {
  cache: {
    expirationSec: 900
  },
  listen: {
    host: '0.0.0.0',
    port: 9050,
    corsDomain: '*',
    trustProxy: false,
    rateLimiter: {
      windowMs: 5000,
      limit: 1
    }
  },
  ninja: {
    baseUrl: 'https://poe.ninja/poe1/api',
    timeoutMs: 10000
  }
};

describe('loadConfig', () => {
  const saved = new Map<string, string | undefined>();

  /**
   * Replaces every setting this suite touches, so the result does not depend on
   * whatever POE_* variables the surrounding shell happens to export.
   */
  function setEnv(values: Record<string, string>): void {
    for (const key of managedKeys) {
      if (!saved.has(key)) {
        saved.set(key, process.env[key]);
      }

      delete process.env[key];
    }

    Object.assign(process.env, values);
  }

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    saved.clear();
    mock.restoreAll();
  });

  function stubLoadEnvFile(impl = () => {}): Mock<typeof process.loadEnvFile> {
    // the real call depends on whether a .env sits on disk, which would make
    // both branches below flip based on the checkout rather than the test
    return mock.method(process, 'loadEnvFile', impl);
  }

  it('reads a .env file before falling back to the ambient environment', () => {
    const loadEnvFile = stubLoadEnvFile();

    setEnv({ POE_WEB_PORT: '1234', POE_CACHE_EXPIRATION_SEC: '30' });

    const config = loadConfig();

    assert.equal(loadEnvFile.mock.callCount(), 1);
    assert.equal(config.listen.port, 1234);
    assert.equal(config.cache.expirationSec, 30);
    assert.equal(config.listen.host, defaults.listen.host);
  });

  it('carries on when there is no .env on disk', () => {
    const loadEnvFile = stubLoadEnvFile(() => {
      throw new Error("ENOENT: no such file or directory, open '.env'");
    });

    setEnv({ POE_WEB_HOST: '127.0.0.1' });

    const config = loadConfig();

    assert.equal(loadEnvFile.mock.callCount(), 1);
    assert.equal(config.listen.host, '127.0.0.1');
    assert.equal(config.listen.port, defaults.listen.port);
  });

  it('treats an explicitly passed process.env as the ambient environment', () => {
    const loadEnvFile = stubLoadEnvFile();

    loadConfig(process.env);

    assert.equal(loadEnvFile.mock.callCount(), 1);
  });

  it('leaves the .env file alone when handed an environment', () => {
    const loadEnvFile = stubLoadEnvFile();

    const config = loadConfig({});

    assert.equal(loadEnvFile.mock.callCount(), 0);
    assert.deepEqual(config, defaults);
  });

  it('reads every setting from the supplied environment', () => {
    const config = loadConfig({
      POE_CACHE_EXPIRATION_SEC: '60',
      POE_WEB_HOST: '127.0.0.1',
      POE_WEB_PORT: '8080',
      POE_WEB_CORS_DOMAIN: 'https://example.com',
      POE_WEB_TRUST_PROXY: 'true',
      POE_WEB_LIMITER_WINDOW_MS: '2500',
      POE_WEB_LIMITER_LIMIT: '10',
      POE_NINJA_BASE_URL: 'https://poe.ninja/poe2/api',
      POE_NINJA_TIMEOUT_MS: '1500'
    });

    assert.deepEqual(config, {
      cache: {
        expirationSec: 60
      },
      listen: {
        host: '127.0.0.1',
        port: 8080,
        corsDomain: 'https://example.com',
        trustProxy: true,
        rateLimiter: {
          windowMs: 2500,
          limit: 10
        }
      },
      ninja: {
        baseUrl: 'https://poe.ninja/poe2/api',
        timeoutMs: 1500
      }
    });
  });

  it('only trusts the proxy for the string "true"', () => {
    for (const POE_WEB_TRUST_PROXY of ['false', '1', 'ture', '']) {
      assert.equal(
        loadConfig({ POE_WEB_TRUST_PROXY }).listen.trustProxy,
        false,
        `expected "${POE_WEB_TRUST_PROXY}" not to enable trust proxy`
      );
    }
    assert.equal(
      loadConfig({ POE_WEB_TRUST_PROXY: 'True' }).listen.trustProxy,
      true,
      'expected "True" to enable trust proxy'
    );
  });
});
