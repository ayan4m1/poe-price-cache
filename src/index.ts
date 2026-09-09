import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const { cache, listen } = config;

createApp(config).listen(listen.port, listen.host, () =>
  console.log(
    `poe-price-cache listening on ${listen.host}:${listen.port} - caching for ${cache.expirationSec}s, ${listen.rateLimiter.limit} req / ${listen.rateLimiter.windowMs}ms per IP`
  )
);
