import { CacheConfig, ListenConfig } from './types';

try {
  process.loadEnvFile();
} catch {
  // no .env on disk - fall back to the ambient environment, which is how
  // docker compose supplies configuration via env_file
}

export const cache: CacheConfig = {
  expirationSec: parseInt(process.env.POE_CACHE_EXPIRATION_SEC || '900', 10)
};

export const listen: ListenConfig = {
  host: process.env.POE_WEB_HOST || '0.0.0.0',
  port: parseInt(process.env.POE_WEB_PORT || '9050', 10),
  corsDomain: process.env.POE_WEB_CORS_DOMAIN || '*',
  rateLimiter: {
    windowMs: parseInt(process.env.POE_WEB_LIMITER_WINDOW_MS || '5000', 10),
    limit: parseInt(process.env.POE_WEB_LIMITER_LIMIT || '1', 10)
  }
};
