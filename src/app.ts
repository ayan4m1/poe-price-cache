import Bottleneck from 'bottleneck';
import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { loadConfig } from './config.ts';
import {
  exchangeItemTypes,
  stashCurrencyTypes,
  stashItemTypes
} from './types.ts';
import type { AppConfig } from './types.ts';
import {
  createCache,
  createLimiters,
  createNinjaClient,
  UpstreamError
} from './utils.ts';

const stashOverviewPath = '/economy/stash/current/item/overview';
const exchangeOverviewPath = '/economy/exchange/current/overview';
const stashCurrencyPath = '/economy/stash/current/currency/overview';
const leaguePattern = /^[A-Za-z0-9 ._-]{1,32}$/;

/**
 * Builds the Express application. Everything stateful - the cache, the per-IP
 * limiters and the upstream client - is constructed here from `config` rather
 * than shared at module scope, so that each instance is independent.
 *
 * `app.locals.dispose()` releases the timers those pieces own.
 */
export function createApp(config: AppConfig = loadConfig()): Express {
  const { cache: cacheConfig, listen, ninja } = config;
  const retryAfterSec = Math.ceil(listen.rateLimiter.windowMs / 1000);
  const cache = createCache(cacheConfig.expirationSec);
  const limiters = createLimiters(listen.rateLimiter);
  const client = createNinjaClient(ninja);

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', listen.trustProxy);
  app.use(cors({ origin: listen.corsDomain }));

  // Bottleneck unrefs its own timers, but releasing them keeps a test run that
  // builds many apps from accumulating idle limiters
  app.locals.dispose = async () => {
    cache.close();
    clearInterval(
      (limiters as unknown as { interval?: NodeJS.Timeout }).interval
    );
    await Promise.all(
      limiters.limiters().map(({ limiter }) => limiter.disconnect(false))
    );
  };

  // registered before the limiter so health checks are never throttled
  app.get('/health', (_: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      // acquiring a token is the whole job - the request itself runs outside
      // the limiter so a slow upstream call cannot occupy the reservoir
      await limiters.key(req.ip ?? 'unknown').schedule(() => Promise.resolve());
      next();
    } catch (error) {
      if (error instanceof Bottleneck.BottleneckError) {
        res
          .set('Retry-After', String(retryAfterSec))
          .status(429)
          .json({ error: 'Too many requests' });
      } else {
        next(error);
      }
    }
  });

  app.get('/economy/leagues', async (_: Request, res: Response) => {
    const { value, hit } = await cache.cached('/economy/leagues', () =>
      client.fetch('/economy/leagues')
    );

    res.set('X-Cache', hit ? 'HIT' : 'MISS').json(value);
  });

  /**
   * Both overview routes take the same league/type pair and differ only in which
   * types the upstream accepts, so they share one handler.
   */
  function overview(path: string, types: readonly string[]) {
    return async (req: Request, res: Response) => {
      const { league, type } = req.query;

      // validating both parameters keeps the cache key space bounded
      if (typeof league !== 'string' || !leaguePattern.test(league)) {
        res
          .status(400)
          .json({ error: 'league is required and must be a valid league id' });
        return;
      }

      if (typeof type !== 'string' || !types.includes(type)) {
        res
          .status(400)
          .json({ error: `type must be one of: ${types.join(', ')}` });
        return;
      }

      const { value, hit } = await cache.cached(
        `${path}?league=${league}&type=${type}`,
        () => client.fetch(path, { league, type })
      );

      res.set('X-Cache', hit ? 'HIT' : 'MISS').json(value);
    };
  }

  app.get(stashOverviewPath, overview(stashOverviewPath, stashItemTypes));
  app.get(stashCurrencyPath, overview(stashCurrencyPath, stashCurrencyTypes));
  app.get(
    exchangeOverviewPath,
    overview(exchangeOverviewPath, exchangeItemTypes)
  );

  app.use((_: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Express only treats a middleware as an error handler when it declares four
  // parameters, so `next` must stay in the signature
  app.use((error: Error, _: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof UpstreamError) {
      res.status(error.status).json({ error: error.message });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}
