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
