import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';

import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('../package.json');
const loadJson = require.extensions['.json'];

/**
 * The User-Agent is built once, when src/utils.ts is first evaluated, so the
 * manifest has to be unreadable before that import happens. Node gives each
 * test file its own process, so nothing here has loaded either one yet.
 */
async function importWithoutManifest() {
  delete require.cache[packagePath];
  require.extensions['.json'] = (module, filename) => {
    // scoped to our own manifest so a dependency loading JSON still works
    if (filename === packagePath) {
      throw new Error('simulated unreadable package.json');
    }

    return loadJson(module, filename);
  };

  try {
    return await import('../src/utils.ts');
  } finally {
    require.extensions['.json'] = loadJson;
    delete require.cache[packagePath];
  }
}

const { createNinjaClient } = await importWithoutManifest();

describe('an unreadable package manifest', () => {
  let upstream: FakeUpstream;

  before(async () => {
    upstream = await startUpstream({ status: 200, body: [] });
  });

  after(async () => {
    await upstream.close();
  });

  it('still identifies itself, with an unknown version', async () => {
    const client = createNinjaClient({
      baseUrl: upstream.baseUrl,
      timeoutMs: 5000
    });

    await client.fetch('/economy/leagues');

    assert.equal(upstream.count, 1);
    assert.equal(
      upstream.requests[0].headers['user-agent'],
      'poe-price-cache/unknown (+https://github.com/ayan4m1/poe-price-cache)'
    );
  });
});
