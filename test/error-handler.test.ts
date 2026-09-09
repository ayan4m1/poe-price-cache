import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Mock } from 'node:test';

import { response as responsePrototype } from 'express';
import type { Response } from 'express';

import { startApp } from './helpers/app.ts';
import type { TestApp } from './helpers/app.ts';

describe('the error handler', () => {
  let app: TestApp;
  let error: Mock<typeof console.error>;

  beforeEach(async () => {
    // the generic branch logs the error; keep the run quiet and assert on it
    error = mock.method(console, 'error', () => {});
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

    // express destroys the socket rather than writing a second status line
    await assert.rejects(() => app.get('/health'));

    // express's own finalhandler logs the stack as a string once it takes the
    // error back; the generic branch would have logged the Error itself, so an
    // absence of one proves the headersSent path ran instead
    assert.deepEqual(
      error.mock.calls
        .map(({ arguments: [first] }) => first)
        .filter((logged) => logged instanceof Error),
      []
    );
  });

  it('answers a healthy request normally', async () => {
    const res = await app.get('/health');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
    assert.equal(error.mock.callCount(), 0);
  });
});
