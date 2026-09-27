/**
 * `Unifi.FirewallPolicyOrdering`'s `spec` against a fake UniFi Network API — mirrors
 * `acl-rule-ordering.test.ts`. The two things this file exists to prove that no other family test
 * does: the zone-pair QUERY identity actually reaches the wire (unlike `acl-rule-ordering.ts`'s
 * one-per-site path with no query at all), and T5's "order IS the value, never `sortedSet`" rule
 * holds independently for BOTH `beforeSystemDefined` and `afterSystemDefined`.
 */
import { describe, expect, test } from 'bun:test';
import type * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf, driftOf, matches } from './firewall-policy-ordering-form.ts';
import {
  type FirewallPolicyOrderingProps,
  declareFirewallPolicyOrdering,
  spec,
} from './firewall-policy-ordering.ts';
import { unifiOperations } from './resource.ts';

const ORDERING_PATH = '/proxy/network/integration/v1/sites/site-1/firewall/policies/ordering';

const liveOrdering = (
  overrides: Partial<firewall.IntegrationFirewallPolicyOrderingDto> = {},
): firewall.IntegrationFirewallPolicyOrderingDto => ({
  orderedFirewallPolicyIds: {
    beforeSystemDefined: ['fp-1', 'fp-2'],
    afterSystemDefined: ['fp-9'],
  },
  ...overrides,
});

const PROPS: FirewallPolicyOrderingProps = {
  siteId: 'site-1',
  sourceFirewallZoneId: 'zone-iot',
  destinationFirewallZoneId: 'zone-external',
  beforeSystemDefined: ['fp-1', 'fp-2'],
  afterSystemDefined: ['fp-9'],
};

describe('Unifi.FirewallPolicyOrdering spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object, with the zone pair as a query', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(liveOrdering())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.orderedFirewallPolicyIds.beforeSystemDefined).toEqual(['fp-1', 'fp-2']);
    expect(fake.seen).toHaveLength(1);
    const sentUrl = new URL(`http://x${fake.seen[0]?.path}`);
    expect(sentUrl.pathname).toBe(ORDERING_PATH);
    expect(sentUrl.searchParams.get('sourceFirewallZoneId')).toBe('zone-iot');
    expect(sentUrl.searchParams.get('destinationFirewallZoneId')).toBe('zone-external');
  });

  test('a genuine 404 folds to undefined', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 500 fails loudly -- only a genuine not-found may mean absent (T14)', async () => {
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareFirewallPolicyOrdering -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveOrdering({
      orderedFirewallPolicyIds: { beforeSystemDefined: ['fp-5'], afterSystemDefined: [] },
    });
    const declared = declareFirewallPolicyOrdering(live, 'site-1', 'zone-iot', 'zone-external');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
  });
});

describe('T5 -- order IS the value, never sortedSet, independently on each half', () => {
  test('an identical pair of lists is a noop', () => {
    expect(driftOf(liveOrdering(), PROPS)).toEqual([]);
    expect(matches(attributesOf(liveOrdering(), PROPS), PROPS)).toBe(true);
  });

  test('the SAME ids in a DIFFERENT order within beforeSystemDefined is real drift', () => {
    const live = liveOrdering({
      orderedFirewallPolicyIds: {
        beforeSystemDefined: ['fp-2', 'fp-1'],
        afterSystemDefined: ['fp-9'],
      },
    });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(false);
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'beforeSystemDefined', live: ['fp-2', 'fp-1'], declared: ['fp-1', 'fp-2'] },
    ]);
  });

  test('a reorder within afterSystemDefined alone is caught, beforeSystemDefined untouched', () => {
    const live = liveOrdering({
      orderedFirewallPolicyIds: {
        beforeSystemDefined: ['fp-1', 'fp-2'],
        afterSystemDefined: ['fp-9', 'fp-10'],
      },
    });
    const props: FirewallPolicyOrderingProps = { ...PROPS, afterSystemDefined: ['fp-10', 'fp-9'] };
    expect(driftOf(live, props)).toEqual([
      { field: 'afterSystemDefined', live: ['fp-9', 'fp-10'], declared: ['fp-10', 'fp-9'] },
    ]);
  });

  test('a policy moving from beforeSystemDefined to afterSystemDefined drifts on both fields', () => {
    // The two halves can never swap through this endpoint by "reordering" alone -- membership moving
    // across them is a genuine drift on each side independently, not one combined-list reorder.
    const live = liveOrdering({
      orderedFirewallPolicyIds: {
        beforeSystemDefined: ['fp-1'],
        afterSystemDefined: ['fp-2', 'fp-9'],
      },
    });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'beforeSystemDefined', live: ['fp-1'], declared: ['fp-1', 'fp-2'] },
      { field: 'afterSystemDefined', live: ['fp-2', 'fp-9'], declared: ['fp-9'] },
    ]);
  });
});

describe('Unifi.FirewallPolicyOrdering write paths never reach the vendor API', () => {
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

  test('reconcile on drift (a reorder) refuses instead of PUTting the whole pair', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ORDERING_PATH
        ? Response.json(
            liveOrdering({
              orderedFirewallPolicyIds: {
                beforeSystemDefined: ['fp-2', 'fp-1'],
                afterSystemDefined: [],
              },
            }),
          )
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
