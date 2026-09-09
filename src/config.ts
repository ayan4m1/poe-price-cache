import type { AppConfig } from './types.ts';

/**
 * Reads configuration from `env`, defaulting to the process environment. This
 * is a function rather than a set of module-level constants so that importing
 * the module has no side effects and tests can supply their own environment.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    try {
      process.loadEnvFile();
    } catch {
      // no .env on disk - fall back to the ambient environment, which is how
      // docker compose supplies configuration via env_file
    }
  }

  return {
    cache: {
      expirationSec: parseInt(env.POE_CACHE_EXPIRATION_SEC || '900', 10)
    },
    listen: {
      host: env.POE_WEB_HOST || '0.0.0.0',
      port: parseInt(env.POE_WEB_PORT || '9050', 10),
      corsDomain: env.POE_WEB_CORS_DOMAIN || '*',
      trustProxy: env.POE_WEB_TRUST_PROXY === 'true',
      rateLimiter: {
        windowMs: parseInt(env.POE_WEB_LIMITER_WINDOW_MS || '5000', 10),
        limit: parseInt(env.POE_WEB_LIMITER_LIMIT || '1', 10)
      }
    },
    ninja: {
      baseUrl: env.POE_NINJA_BASE_URL || 'https://poe.ninja/poe1/api',
      timeoutMs: parseInt(env.POE_NINJA_TIMEOUT_MS || '10000', 10)
    }
  };
}
