import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

export type UpstreamRequest = {
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
};

export type UpstreamResponse = {
  /** HTTP status to answer with. Defaults to 200. */
  status?: number;
  /** JSON-serialized into the body. Ignored when `raw` is given. */
  body?: unknown;
  /** Written verbatim, for malformed-JSON cases. */
  raw?: string;
  /** Milliseconds to wait before answering, for timeout cases. */
  delayMs?: number;
  /** Destroy the socket instead of replying. */
  hangUp?: boolean;
};

export type FakeUpstream = {
  /** Value for `AppConfig['ninja'].baseUrl`. */
  baseUrl: string;
  /** Every request the app has made, in order. */
  requests: UpstreamRequest[];
  /** Number of requests received - the cache assertions all read this. */
  readonly count: number;
  /** Sets the default answer for every subsequent request. */
  respondWith(response: UpstreamResponse): void;
  /** Queues a one-shot answer, consumed ahead of the default. */
  respondOnceWith(response: UpstreamResponse): void;
  /**
   * Holds every response until `release()` is called. Used to keep concurrent
   * requests in flight at the same time.
   */
  hold(): () => void;
  /** Resolves once at least `count` requests have arrived. */
  waitFor(count: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
};

/**
 * A stand-in for poe.ninja listening on an ephemeral port, so the tests
 * exercise the real fetch path - status codes, headers, timeouts and all.
 */
export async function startUpstream(
  initial: UpstreamResponse = { status: 200, body: [] }
): Promise<FakeUpstream> {
  const requests: UpstreamRequest[] = [];
  const queued: UpstreamResponse[] = [];

  let fallback = initial;
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://upstream');

    requests.push({
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers
    });

    const response = queued.shift() ?? fallback;

    void (async () => {
      if (gate) {
        await gate;
      }

      if (response.delayMs) {
        await delay(response.delayMs);
      }

      if (response.hangUp) {
        req.socket.destroy();
        return;
      }

      res.writeHead(response.status ?? 200, {
        'content-type': 'application/json'
      });
      res.end(response.raw ?? JSON.stringify(response.body ?? []));
    })();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('upstream did not bind a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/poe1/api`,
    requests,
    get count() {
      return requests.length;
    },
    respondWith(response) {
      fallback = response;
    },
    respondOnceWith(response) {
      queued.push(response);
    },
    async waitFor(count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;

      while (requests.length < count) {
        if (Date.now() > deadline) {
          throw new Error(
            `upstream saw ${requests.length} requests, expected ${count}`
          );
        }

        await delay(10);
      }
    },
    hold() {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });

      return () => {
        openGate?.();
        gate = null;
        openGate = null;
      };
    },
    async close() {
      openGate?.();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  };
}
