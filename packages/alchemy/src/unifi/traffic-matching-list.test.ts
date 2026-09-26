/**
 * `Unifi.TrafficMatchingList`'s `spec` against a fake UniFi Network API — mirrors
 * `dns-policy.test.ts`. `driftOf`/`matches` coverage lives here too, same reasoning as that file's
 * own header (a short field list, no separate need to split under the house cap).
 */
import { describe, expect, test } from 'bun:test';
import type * as trafficMatchingLists from '@distilled.cloud/unifi-network/traffic_matching_lists';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './traffic-matching-list-form.ts';
import { driftOf, matches } from './traffic-matching-list-drift.ts';
import {
  type TrafficMatchingListProps,
  declareTrafficMatchingList,
  spec,
} from './traffic-matching-list.ts';
import { unifiOperations } from './resource.ts';

const LIST_PATH = '/proxy/network/integration/v1/sites/site-1/traffic-matching-lists/tml-1';

const liveTrafficMatchingList = (
  overrides: Partial<trafficMatchingLists.TrafficMatchingList> = {},
): trafficMatchingLists.TrafficMatchingList => ({
  id: 'tml-1',
  name: 'Office subnets',
  type: 'IPV4',
  items: [{ type: 'SUBNET', value: '192.0.2.0/24' }],
  ...overrides,
});

const PROPS: TrafficMatchingListProps = {
  siteId: 'site-1',
  trafficMatchingListId: 'tml-1',
  name: 'Office subnets',
  type: 'IPV4',
  items: [{ type: 'SUBNET', value: '192.0.2.0/24' }],
};

describe('Unifi.TrafficMatchingList spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json(liveTrafficMatchingList())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('tml-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: LIST_PATH }]);
  });

  test('a genuine 404 folds to undefined -- never a false "unreadable" on anything else', async () => {
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

describe('declareTrafficMatchingList -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    // A different discriminator case than the default fixture (`PortMatching[]`, not
    // `IPv4Matching[]`) -- a fresh literal, not the SUBNET fixture's overrides.
    const live: trafficMatchingLists.TrafficMatchingList = {
      id: 'tml-2',
      name: 'Management ports',
      type: 'PORT',
      items: [{ type: 'RANGE', start: 8000, stop: 8100 }],
    };
    const declared = declareTrafficMatchingList(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
    expect(driftOf(live, declared)).toEqual([]);
  });
});

describe('driftOf -- B6 field-level drift, straight from one live read', () => {
  test('a real name change reports its own field, live and declared', () => {
    const live = liveTrafficMatchingList({ name: 'Office /24s' });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'name', live: 'Office /24s', declared: 'Office subnets' },
    ]);
  });

  test('items compares wholesale -- a real membership change is caught', () => {
    const live = liveTrafficMatchingList({ items: [{ type: 'SUBNET', value: '203.0.113.0/24' }] });
    expect(driftOf(live, PROPS)).toEqual([
      {
        field: 'items',
        live: [{ type: 'SUBNET', value: '203.0.113.0/24' }],
        declared: [{ type: 'SUBNET', value: '192.0.2.0/24' }],
      },
    ]);
  });

  test('a live object with no items key at all is a noop against declared undefined', () => {
    // `exactOptionalPropertyTypes`: the SDK's own `items?` type has no explicit `| undefined`, so
    // this omits the key entirely rather than setting it to `undefined` -- the real wire shape for
    // a list with no match entries yet.
    const live: trafficMatchingLists.TrafficMatchingList = {
      id: 'tml-1',
      name: 'Office subnets',
      type: 'IPV4',
    };
    const props: TrafficMatchingListProps = { ...PROPS, items: undefined };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
  });
});

describe('Unifi.TrafficMatchingList write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json(liveTrafficMatchingList())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('reconcile on drift refuses instead of PUTting a merged body', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json(liveTrafficMatchingList({ name: 'Renamed elsewhere' }))
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
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json(liveTrafficMatchingList())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
