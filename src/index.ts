import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { getLogger, setLogLevel } from './logging.ts';

const log = getLogger('index');
const config = loadConfig();
const { cache, listen } = config;

setLogLevel(config.log.level);

createApp(config).listen(listen.port, listen.host, () =>
  log.info(
    `poe-price-cache listening on ${listen.host}:${listen.port} - caching for ${cache.expirationSec}s, ${listen.rateLimiter.limit} req / ${listen.rateLimiter.windowMs}ms per IP`
  )
);
