import Bottleneck from 'bottleneck';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';

import { cache, listen } from './config';
import { exchangeItemTypes, stashCurrencyTypes, stashItemTypes } from './types';
import { cached, fetchNinja, limiters, UpstreamError } from './utils';

const stashOverviewPath = '/economy/stash/current/item/overview';
const exchangeOverviewPath = '/economy/exchange/current/overview';
const stashCurrencyPath = '/economy/stash/current/currency/overview';
const leaguePattern = /^[A-Za-z0-9 ._-]{1,64}$/;
const retryAfterSec = Math.ceil(listen.rateLimiter.windowMs / 1000);

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', listen.trustProxy);
app.use(cors({ origin: listen.corsDomain }));

// registered before the limiter so health checks are never throttled
app.get('/health', (_req: Request, res: Response) => {
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

app.get('/economy/leagues', async (_req: Request, res: Response) => {
  const { value, hit } = await cached('/economy/leagues', () =>
    fetchNinja('/economy/leagues')
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

    const { value, hit } = await cached(
      `${path}?league=${league}&type=${type}`,
      () => fetchNinja(path, { league, type })
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

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof UpstreamError) {
    res.status(502).json({ error: error.message });
  } else {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(listen.port, listen.host, () =>
  console.log(
    `poe-price-cache listening on ${listen.host}:${listen.port} - caching for ${cache.expirationSec}s, ${listen.rateLimiter.limit} req / ${listen.rateLimiter.windowMs}ms per IP`
  )
);
