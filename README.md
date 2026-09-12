# PoE Price Cache

[![codecov](https://codecov.io/gh/ayan4m1/poe-price-cache/graph/badge.svg?token=daFDsOfdPb)](https://codecov.io/gh/ayan4m1/poe-price-cache)

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

Configuration is done by `.env` file and/or environment variables (see `.env.default`).

Two variables control access to the upstream poe.ninja API:

- `POE_NINJA_BASE_URL` - the poe.ninja API root, default `https://poe.ninja/poe1/api`
- `POE_NINJA_TIMEOUT_MS` - how long to wait for a poe.ninja response, default `10000`

`POE_CACHE_EXPIRATION_SEC` must be a positive integer for caching to work correctly.

If you are hosting behind a proxy like nginx, set:

```sh
POE_WEB_TRUST_PROXY=true
```

This allows the rate limiting to work correctly based on the IP address given to us by the proxy server in `X-Forwarded-For`.

**WARNING:** make sure that the `POE_WEB_TRUST_PROXY` is `false` unless you are using a proxy, since this will allow an attacker to impersonate any IP address ahd bypass rate limiting.

## Testing

The suite runs on the built-in Node test runner (Node 22 or newer), straight from the TypeScript sources - no build step and no test dependencies:

> npm test

Tests start a local mock HTTP server and points the app at it with `POE_NINJA_BASE_URL`.
