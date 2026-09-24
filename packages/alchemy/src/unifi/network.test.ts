/**
 * `Unifi.Network`'s `spec` against a fake UniFi Network API, proving the real distilled wire
 * path (path assembly, JSON decode, `NotFound` folding), the declaration renderer, and — the
 * task's own requirement — that no handler this family exposes ever sends a non-`GET` request.
 */
import { describe, expect, test } from 'bun:test';
import type * as networks from '@distilled.cloud/unifi-network/networks';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf, matches } from './network-form.ts';
import { type NetworkProps, declareNetwork, spec } from './network.ts';
import { unifiOperations } from './resource.ts';

const NETWORK_PATH = '/proxy/network/integration/v1/sites/site-1/networks/net-1';

const liveNetwork = (
  overrides: Partial<networks.NetworkDetails> = {},
): networks.NetworkDetails => ({
  default: false,
  enabled: true,
  id: 'net-1',
  management: 'ADVANCED',
  metadata: { origin: 'USER' },
  name: 'Cameras',
  vlanId: 40,
  isolationEnabled: true,
  zoneId: 'zone-1',
  ...overrides,
});

const PROPS: NetworkProps = {
  siteId: 'site-1',
  networkId: 'net-1',
  name: 'Cameras',
  enabled: true,
  management: 'ADVANCED',
  vlanId: 40,
  isolationEnabled: true,
  zoneId: 'zone-1',
};

describe('Unifi.Network spec.fetchLive', () => {
  test('a real GET response decodes into the typed live object', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === NETWORK_PATH
        ? Response.json(liveNetwork())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('net-1');
    expect(fake.seen).toEqual([{ method: 'GET', path: NETWORK_PATH }]);
  });

  test('a genuine 404 folds to undefined -- never a false "unreadable" on anything else', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 500 fails loudly -- only a genuine not-found may mean absent', async () => {
    // ⚠️ `Retry.none`: the default policy retries a 500 (one of core's DEFAULT_ERROR_STATUSES)
    //   indefinitely with backoff -- this test asserts the FAILURE, not the retry schedule.
    const fake = fakeUnifi(() => fakeFailure(500, 'boom'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive(PROPS).pipe(Retry.none, Effect.provide(fakeUnifiLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('InternalServerError');
  });
});

describe('declareNetwork -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveNetwork({ name: 'Guest', vlanId: 99, isolationEnabled: false });
    const declared = declareNetwork(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
  });
});

describe('Unifi.Network write paths never reach the vendor API', () => {
  const ops = unifiOperations(spec);

  test('reconcile on an exact-match adoption (H6) makes no request but the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === NETWORK_PATH
        ? Response.json(liveNetwork())
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
      method === 'GET' && url.pathname === NETWORK_PATH
        ? Response.json(liveNetwork({ vlanId: 999 }))
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
      method === 'GET' && url.pathname === NETWORK_PATH
        ? Response.json(liveNetwork())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      ops.destroy(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
