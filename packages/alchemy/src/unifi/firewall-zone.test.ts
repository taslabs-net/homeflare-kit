/**
 * `Unifi.FirewallZone`'s `spec` against a fake UniFi Network API — mirrors `network.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf, matches } from './firewall-zone-form.ts';
import { type FirewallZoneProps, declareFirewallZone, spec } from './firewall-zone.ts';
import { unifiOperations } from './resource.ts';

const ZONE_PATH = '/proxy/network/integration/v1/sites/site-1/firewall/zones/zone-1';

const liveZone = (overrides: Partial<firewall.FirewallZone> = {}): firewall.FirewallZone => ({
  id: 'zone-1',
  metadata: { origin: 'USER' },
  name: 'Cameras',
  networkIds: ['net-2', 'net-1'],
  ...overrides,
});

const PROPS: FirewallZoneProps = {
  siteId: 'site-1',
  firewallZoneId: 'zone-1',
  name: 'Cameras',
  networkIds: ['net-1', 'net-2'],
};

describe('Unifi.FirewallZone spec.fetchLive', () => {
  test('a real GET response decodes, and networkIds order does not affect matches', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ZONE_PATH
        ? Response.json(liveZone())
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live?.id).toBe('zone-1');
    const attrs = attributesOf(live as firewall.FirewallZone, PROPS);
    expect(matches(attrs, PROPS)).toBe(true);
  });

  test('a genuine 404 folds to undefined', async () => {
    const fake = fakeUnifi(() => fakeFailure(404, 'not found'));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });
});

describe('declareFirewallZone -- the declaration renderer', () => {
  test('its output matches attributesOf(live) by construction, for any live object', () => {
    const live = liveZone({ networkIds: ['net-9', 'net-3', 'net-3'] });
    const declared = declareFirewallZone(live, 'site-1');
    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
  });
});

describe('Unifi.FirewallZone write paths never reach the vendor API', () => {
  test('reconcile on an exact-match adoption (H6) sends only the one read', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ZONE_PATH
        ? Response.json(liveZone())
        : fakeFailure(400, 'unexpected request'),
    );
    const exit = await Effect.runPromiseExit(
      unifiOperations(spec)
        .reconcile(PROPS)
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Success');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('delete always refuses -- no DELETE is ever sent', async () => {
    const fake = fakeUnifi(() => fakeFailure(400, 'unexpected request'));
    const exit = await Effect.runPromiseExit(
      unifiOperations(spec)
        .destroy(PROPS)
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    expect(exit._tag).toBe('Failure');
    expect(fake.seen).toEqual([]);
  });
});
