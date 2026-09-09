import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  exchangeItemTypes,
  stashCurrencyTypes,
  stashItemTypes
} from '../src/types.ts';
import { startApp } from './helpers/app.ts';
import type { TestApp } from './helpers/app.ts';
import { startUpstream } from './helpers/upstream.ts';
import type { FakeUpstream } from './helpers/upstream.ts';

const routes = [
  {
    name: 'stash overview',
    path: '/economy/stash/current/item/overview',
    types: stashItemTypes as readonly string[],
    // a type the other two routes accept but this one must not
    foreignType: 'Scarab'
  },
  {
    name: 'stash currency',
    path: '/economy/stash/current/currency/overview',
    types: stashCurrencyTypes as readonly string[],
    foreignType: 'Scarab'
  },
  {
    name: 'exchange overview',
    path: '/economy/exchange/current/overview',
    types: exchangeItemTypes as readonly string[],
    foreignType: 'SkillGem'
  }
] as const;

const leagueError = 'league is required and must be a valid league id';

const validLeagues = [
  'Standard',
  'Hardcore',
  'Mercenaries HC',
  'Settlers.1',
  'Ancestor_x-2',
  'a',
  'a'.repeat(32)
];

const invalidLeagues: Array<[string, string]> = [
  ['empty', ''],
  ['33 characters', 'a'.repeat(33)],
  ['repeated parameter', 'a&league=b'],
  ['ampersand', 'Std&x'],
  ['slash', 'a/b'],
  ['percent', '50%'],
  ['non-ascii', 'Стандарт']
];

for (const { name, path, types, foreignType } of routes) {
  describe(name, () => {
    let upstream: FakeUpstream;
    let app: TestApp;

    before(async () => {
      upstream = await startUpstream();
      app = await startApp({ ninja: { baseUrl: upstream.baseUrl } });
    });

    after(async () => {
      await app.close();
      await upstream.close();
    });

    beforeEach(() => {
      upstream.requests.length = 0;
      upstream.respondWith({ status: 200, body: [{ ok: true }] });
    });

    // runs first, so no key it touches has been cached yet
    it('accepts every type in its allowlist', async () => {
      for (const type of types) {
        const res = await app.get(
          `${path}?league=Standard&type=${encodeURIComponent(type)}`
        );

        assert.equal(res.status, 200, `${type} should be accepted`);
        assert.deepEqual(res.body, [{ ok: true }]);
      }

      assert.equal(upstream.count, types.length);
    });

    it('forwards the league and type to the upstream path', async () => {
      const res = await app.get(
        `${path}?league=Mercenaries HC&type=${types[0]}`
      );

      assert.equal(res.status, 200);
      assert.equal(upstream.count, 1);

      const request = upstream.requests[0];

      assert.equal(request.path, `/poe1/api${path}`);
      assert.equal(request.query.get('league'), 'Mercenaries HC');
      assert.equal(request.query.get('type'), types[0]);
    });

    for (const league of validLeagues) {
      it(`accepts the league ${JSON.stringify(league)}`, async () => {
        const res = await app.get(
          `${path}?league=${encodeURIComponent(league)}&type=${types[0]}`
        );

        assert.equal(res.status, 200);
      });
    }

    it('rejects a missing league', async () => {
      const res = await app.get(`${path}?type=${types[0]}`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: leagueError });
      assert.equal(upstream.count, 0);
    });

    for (const [label, league] of invalidLeagues) {
      it(`rejects a league with ${label}`, async () => {
        const query =
          label === 'repeated parameter'
            ? `league=${league}`
            : `league=${encodeURIComponent(league)}`;
        const res = await app.get(`${path}?${query}&type=${types[0]}`);

        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { error: leagueError });
        assert.equal(upstream.count, 0);
      });
    }

    const typeError = `type must be one of: ${types.join(', ')}`;

    it('rejects a missing type', async () => {
      const res = await app.get(`${path}?league=Standard`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: typeError });
      assert.equal(upstream.count, 0);
    });

    it('rejects an empty type', async () => {
      const res = await app.get(`${path}?league=Standard&type=`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: typeError });
      assert.equal(upstream.count, 0);
    });

    it('rejects a type with the wrong case', async () => {
      const res = await app.get(
        `${path}?league=Standard&type=${types[0].toLowerCase()}`
      );

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: typeError });
      assert.equal(upstream.count, 0);
    });

    it('rejects an unknown type', async () => {
      const res = await app.get(`${path}?league=Standard&type=Bogus`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: typeError });
      assert.equal(upstream.count, 0);
    });

    it(`rejects ${foreignType}, which belongs to a different route`, async () => {
      assert.ok(
        !types.includes(foreignType),
        `${foreignType} must not be in this route's allowlist`
      );

      const res = await app.get(`${path}?league=Standard&type=${foreignType}`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: typeError });
      assert.equal(upstream.count, 0);
    });

    it('reports the league error when both parameters are invalid', async () => {
      const res = await app.get(`${path}?league=bad%2Fleague&type=Bogus`);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: leagueError });
      assert.equal(upstream.count, 0);
    });
  });
}
