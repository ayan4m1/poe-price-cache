# PoE Price Cache

The [poe.ninja](https://poe.ninja/docs/api) docs tell you to run your own cache server if you are writing an app integration.

This is the simplest form of that cache server - in-memory, simple rate limiting, no frills.

## Install

> cp .env.default .env

Now edit `.env` and set everything up for your environment. Then run:

> docker compose build
> 
> docker compose up -d

If you don't have Docker:

> npm run build
> 
> npm start

## Configuration

Everything is set through the environment (see `.env.default`). Beyond the
listen/limiter/cache settings, two variables control the upstream:

- `POE_NINJA_BASE_URL` - the poe.ninja API root, default
  `https://poe.ninja/poe1/api`
- `POE_NINJA_TIMEOUT_MS` - how long to wait for a poe.ninja response, default
  `10000`

If `POE_CACHE_EXPIRATION_SEC` is not a positive number, caching is disabled and
a warning is logged at startup.

## Testing

The suite runs on the built-in Node test runner (Node 22 or newer), straight
from the TypeScript sources - no build step and no test dependencies:

> npm test

Tests never talk to poe.ninja. Each one starts a local stand-in server and
points the app at it with `POE_NINJA_BASE_URL`.

> npm run typecheck
>
> npm run lint
