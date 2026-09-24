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

describe('matches -- unordered arrays (dhcpGuarding, ipv6Configuration)', () => {
  // ⛔ `deepEqual` (alchemy/Diff) sorts object keys but not array elements: without normalizing
  //   these three fields (see network-form.ts's header), a console returning the same set in a
  //   different order would plan a spurious update.
  test('the same trusted DHCP servers in a different order is a noop', () => {
    const live = liveNetwork({
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.2', '10.0.0.1'] },
    });
    const props: NetworkProps = {
      ...PROPS,
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.1', '10.0.0.2'] },
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
  });

  test('a different set of trusted DHCP servers is an update', () => {
    const live = liveNetwork({
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.1', '10.0.0.2'] },
    });
    const props: NetworkProps = {
      ...PROPS,
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.1', '10.0.0.3'] },
    };
    expect(matches(attributesOf(live, props), props)).toBe(false);
  });

  test('the same IPv6 host subnets and DNS overrides in a different order is a noop', () => {
    const live = liveNetwork({
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8::/64', '2001:db8:1::/64'],
        dnsServerIpAddressesOverride: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
      },
    });
    const props: NetworkProps = {
      ...PROPS,
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8:1::/64', '2001:db8::/64'],
        dnsServerIpAddressesOverride: ['2001:4860:4860::8844', '2001:4860:4860::8888'],
      },
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
  });

  test('a different set of IPv6 host subnets is an update', () => {
    const live = liveNetwork({
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8::/64', '2001:db8:1::/64'],
      },
    });
    const props: NetworkProps = {
      ...PROPS,
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8::/64', '2001:db8:2::/64'],
      },
    };
    expect(matches(attributesOf(live, props), props)).toBe(false);
  });

  test('a live `null` (not `undefined`) for either field does not throw', () => {
    // UniFi's JSON answers `null` for an unset optional field (see network-form.ts's header) —
    // a reality the SDK's `T | undefined` types don't model. The double cast lands `null` at
    // runtime the same way a real JSON decode would, past what the type system alone allows.
    const live = {
      ...liveNetwork(),
      dhcpGuarding: null,
      ipv6Configuration: null,
    } as unknown as networks.NetworkDetails;
    const declared = declareNetwork(live, 'site-1');
    expect(() => attributesOf(live, declared)).not.toThrow();
    expect(matches(attributesOf(live, declared), declared)).toBe(true);
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
