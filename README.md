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

If you don't have Docker (requires Node 22.18 or newer):

> corepack enable
>
> yarn install
>
> yarn build
>
> yarn start

## Configuration

Configuration is done by `.env` file and/or environment variables (see `.env.default`).

| Variable                    | Default                      | Purpose                                                      |
| --------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `POE_WEB_HOST`              | `0.0.0.0`                    | Address to listen on                                         |
| `POE_WEB_PORT`              | `9050`                       | Port to listen on                                            |
| `POE_WEB_CORS_DOMAIN`       | `*`                          | Value sent in `Access-Control-Allow-Origin`                  |
| `POE_WEB_TRUST_PROXY`       | `false`                      | Trust one proxy hop's `X-Forwarded-For` (see below)          |
| `POE_WEB_LIMITER_WINDOW_MS` | `5000`                       | Rate limit window per client IP, rounded up to 250ms         |
| `POE_WEB_LIMITER_LIMIT`     | `1`                          | Requests allowed per client IP in each window                |
| `POE_CACHE_EXPIRATION_SEC`  | `900`                        | How long a response is cached                                |
| `POE_CACHE_MAX_ENTRIES`     | `1000`                       | Most responses held at once                                  |
| `POE_NINJA_BASE_URL`        | `https://poe.ninja/poe1/api` | The poe.ninja API root                                       |
| `POE_NINJA_TIMEOUT_MS`      | `10000`                      | How long to wait for a poe.ninja response                    |
| `POE_LOG_LEVEL`             | `info`                       | Minimum level logged (`error`, `warn`, `info`, `debug`, ...) |

If `POE_CACHE_EXPIRATION_SEC` is not a positive number, a warning is logged and caching is disabled - every request goes to poe.ninja, though concurrent identical requests still share one upstream call.

`POE_CACHE_MAX_ENTRIES` exists because the cache is keyed on league and type, and a league is
only checked for shape, so without this cap a caller can mint keys faster than they expire and
grow the process until it runs out of memory. When the cache is full the least recently used
entry is dropped. Raise it if you serve many leagues; a value that is not a positive integer
falls back to the default.

If you are hosting behind a proxy like nginx, set:

```sh
POE_WEB_TRUST_PROXY=true
```

This allows the rate limiting to work correctly based on the IP address given to us by the proxy server in `X-Forwarded-For`.

**WARNING:** make sure `POE_WEB_TRUST_PROXY` is `false` unless you are using a proxy, since this will allow an attacker to impersonate any IP address and bypass rate limiting.

## Endpoints

| Route                                          | Query           | Accepted `type` values                 |
| ---------------------------------------------- | --------------- | -------------------------------------- |
| `GET /health`                                  | -               | -                                      |
| `GET /economy/leagues`                         | -               | -                                      |
| `GET /economy/stash/current/item/overview`     | `league`,`type` | `stashItemTypes` in `src/types.ts`     |
| `GET /economy/stash/current/currency/overview` | `league`,`type` | `stashCurrencyTypes` in `src/types.ts` |
| `GET /economy/exchange/current/overview`       | `league`,`type` | `exchangeItemTypes` in `src/types.ts`  |

- `league` must be 1-32 characters of letters, digits, spaces, `.`, `_` or `-`. An invalid `league` or `type` is answered with a JSON `400`.
- Proxied responses carry `X-Cache: HIT` or `X-Cache: MISS`.
- Every route except `/health` is rate limited per client IP, including requests that end in a `400` or `404`. A throttled request gets a `429` with a `Retry-After` header.
- A poe.ninja error status is passed through as-is. If poe.ninja cannot be reached or times out, the response is a `502`.

## Testing

The suite runs on the built-in Node test runner (Node 22.18 or newer), straight from the TypeScript sources - no build step and no test dependencies:

> yarn test

Or, inside the Docker image:

> docker compose run --rm poe-price-cache yarn test

Tests start a local mock HTTP server and point the app at it with `POE_NINJA_BASE_URL`.
