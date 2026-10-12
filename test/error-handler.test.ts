import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { response as responsePrototype } from 'express';
import type { Response } from 'express';

import type { TestApp } from './helpers/app.ts';

// every handled error is logged; keep the run quiet and assert on it
const error = mock.fn<(error: unknown) => void>();

// app.ts takes its logger when it is first loaded, so the mock has to be in
// place before the helper pulls app.ts in
mock.module('../src/logging.ts', {
  namedExports: {
    getLogger: () => ({ error, warn: () => {}, info: () => {} })
  }
});

const { startApp } = await import('./helpers/app.ts');

describe('the error handler', () => {
  let app: TestApp;

  beforeEach(async () => {
    error.mock.resetCalls();
    // /health never touches the upstream, so no fake one is needed
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
    mock.restoreAll();
  });

  it('hands a failure back to express once the response has started', async () => {
    // no route can fail this late on its own, so make res.json flush a partial
    // body before throwing
    mock.method(responsePrototype, 'json', function (this: Response) {
      this.writeHead(200, { 'content-type': 'application/json' });
      this.write('{"status":');
      throw new Error('failed mid-response');
    });

    // express's own finalhandler writes the stack to console.error once it
    // takes the error back, so keep that out of the test output
    mock.method(console, 'error', () => {});

    // express destroys the socket rather than writing a second status line
    await assert.rejects(() => app.get('/health'));

    // the generic branch would have logged through our logger, so silence
    // there proves the headersSent path ran instead
    assert.equal(error.mock.callCount(), 0);
  });

  it('logs nothing for a healthy request', async () => {
    assert.equal((await app.get('/health')).status, 200);
    assert.equal(error.mock.callCount(), 0);
  });
});
