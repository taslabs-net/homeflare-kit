/**
 * `Unifi.AclRuleOrdering`'s `spec` against a fake UniFi Network API — mirrors `acl-rule.test.ts`.
 * The one thing this file exists to prove that no other family test does: T5's "order IS the
 * value, never `sortedSet`" rule actually holds for `orderedAclRuleIds`.
 */
import { describe, expect, test } from 'bun:test';
import type * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf, driftOf, matches } from './acl-rule-ordering-form.ts';
import { type AclRuleOrderingProps, declareAclRuleOrdering, spec } from './acl-rule-ordering.ts';
import { unifiOperations } from './resource.ts';

const ORDERING_PATH = '/proxy/network/integration/v1/sites/site-1/acl-rules/ordering';

const liveOrdering = (
  overrides: Partial<aclRules.ACLRuleOrdering> = {},
): aclRules.ACLRuleOrdering => ({
  orderedAclRuleIds: ['rule-1', 'rule-2', 'rule-3'],
  ...overrides,
});

const PROPS: AclRuleOrderingProps = {
  siteId: 'site-1',
  orderedAclRuleIds: ['rule-1', 'rule-2', 'rule-3'],
};

describe('Unifi.AclRuleOrdering spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(liveOrdering())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.orderedAclRuleIds).toEqual(['rule-1', 'rule-2', 'rule-3']);
    expect(fake.seen).toEqual([{ method: 'GET', path: ORDERING_PATH }]);
  });

  test('a genuine 404 folds to undefined', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 500 fails loudly -- only a genuine not-found may mean absent (T14)', async () => {
    // ⚠️ `Retry.none`: the default policy retries a 500 indefinitely with backoff -- this test
    //   asserts the FAILURE, not the retry schedule. Regression for red-team Important finding 2:
    //   a blanket `Effect.orElseSucceed(() => undefined)` fold would pass every test above too.
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareAclRuleOrdering -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveOrdering({ orderedAclRuleIds: ['rule-9', 'rule-2'] });
    const declared = declareAclRuleOrdering(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
  });
});

describe('T5 -- order IS the value, never sortedSet', () => {
  test('an identical list is a noop', () => {
    expect(driftOf(liveOrdering(), PROPS)).toEqual([]);
    expect(matches(attributesOf(liveOrdering(), PROPS), PROPS)).toBe(true);
  });

  test('the SAME rule ids in a DIFFERENT order is real drift, not a noop', () => {
    // The one behavior `firewall-zone-form.ts`'s `networkIds` and this file must NOT share:
    // there, a reorder is a noop (a set); here, it is the whole point of the resource.
    const live = liveOrdering({ orderedAclRuleIds: ['rule-2', 'rule-1', 'rule-3'] });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(false);
    expect(driftOf(live, PROPS)).toEqual([
      {
        field: 'orderedAclRuleIds',
        live: ['rule-2', 'rule-1', 'rule-3'],
        declared: ['rule-1', 'rule-2', 'rule-3'],
      },
    ]);
  });

  test('a genuinely different rule set (not just reordered) is also drift', () => {
    const live = liveOrdering({ orderedAclRuleIds: ['rule-1', 'rule-4'] });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(false);
  });
});

describe('Unifi.AclRuleOrdering write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(liveOrdering())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('reconcile on drift (a reorder) refuses instead of PUTting the whole list', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(liveOrdering({ orderedAclRuleIds: ['rule-3', 'rule-2', 'rule-1'] }))
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('delete always refuses -- no DELETE is ever sent', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(liveOrdering())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
