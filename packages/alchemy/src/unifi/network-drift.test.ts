/**
 * `Unifi.Network`'s `driftOf`/`matches` (`network-drift.ts`, B6) — split out of `network.test.ts`
 * to keep that file under the house 250-line cap once this coverage grew, not because this is a
 * different family (same split `network-drift.ts` itself is from `network-form.ts`).
 *
 * Since MEDIUM-4 (red team, 2026-09-26), `matches` IS `fieldDrift(...).length === 0` — there is no
 * second, hand-written comparison — so every test below exercises both functions together on
 * purpose, proving they cannot disagree rather than merely asserting each looks right alone.
 */
import { describe, expect, test } from 'bun:test';
import type * as networks from '@distilled.cloud/unifi-network/networks';
import { attributesOf } from './network-form.ts';
import { driftOf, matches } from './network-drift.ts';
import { type NetworkProps, declareNetwork } from './network.ts';

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

describe('driftOf -- B6 field-level drift, straight from one live read', () => {
  test('a live object that matches its declaration drifts on nothing', () => {
    const live = liveNetwork();
    expect(driftOf(live, PROPS)).toEqual([]);
  });

  test('a drifted field reports its own live and declared values, by name', () => {
    const live = liveNetwork({ vlanId: 999 });
    expect(driftOf(live, PROPS)).toEqual([{ field: 'vlanId', live: 999, declared: 40 }]);
  });

  test('agrees with matches() on every case matches() already covers', () => {
    const live = liveNetwork({ name: 'Guest', vlanId: 7 });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(false);
    expect(driftOf(live, PROPS).length > 0).toBe(true);
  });

  // MEDIUM-4 (red team, 2026-09-26) Mutant B: deleting the `zoneId`/`deviceId` entries from
  // `fieldDrift` entirely left 56/56 green, because nothing exercised a live/declared difference
  // on either field. `matches` now IS `fieldDrift(...).length === 0` (no second comparison to fall
  // back on), so this closes the gap for both functions at once, not just `driftOf`. Verified by
  // hand: reverting `fieldDrift` to drop these two entries fails both tests below.
  test('a zoneId difference is caught, not silently dropped from either comparison', () => {
    const live = liveNetwork({ zoneId: 'zone-9' });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(false);
    expect(driftOf(live, PROPS)).toEqual([{ field: 'zoneId', live: 'zone-9', declared: 'zone-1' }]);
  });

  test('a deviceId difference is caught, not silently dropped from either comparison', () => {
    const props: NetworkProps = { ...PROPS, deviceId: 'device-1' };
    const live = liveNetwork({ deviceId: 'device-2' });
    expect(matches(attributesOf(live, props), props)).toBe(false);
    expect(driftOf(live, props)).toEqual([
      { field: 'deviceId', live: 'device-2', declared: 'device-1' },
    ]);
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
    // MEDIUM-4: `driftOf` shares `matches`' own field list now, so a normalizer this test relies
    // on being applied to the DECLARED side (T15) getting dropped would show up here too.
    expect(driftOf(live, props)).toEqual([]);
  });

  test('the DECLARED side is also normalized, not just live (MEDIUM-4 mutant)', () => {
    // The previous test's PROPS happens to already be sorted, so it can't tell a real normalizer
    // from one silently applied to only the live side -- a red-team mutant that dropped
    // `normalizeDhcpGuarding` from `network-drift.ts`'s DECLARED closure left every test (this
    // file included, before this one) green. Reversing PROPS here, with live already sorted,
    // exercises the declared-side call directly. Verified by hand: this test fails against that
    // exact mutant; every other test in this file still passes against it.
    const live = liveNetwork({
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.1', '10.0.0.2'] },
    });
    const props: NetworkProps = {
      ...PROPS,
      dhcpGuarding: { trustedDhcpServerIpAddresses: ['10.0.0.2', '10.0.0.1'] },
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
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
    expect(driftOf(live, props).some((d) => d.field === 'dhcpGuarding')).toBe(true);
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
    expect(driftOf(live, props)).toEqual([]);
  });

  test('the DECLARED side of IPv6 subnets/DNS overrides is also normalized (MEDIUM-4 mutant)', () => {
    // Same blind spot as the DHCP test above, for both ipv6Configuration override lists: live is
    // already sorted here, so only reversing PROPS exercises the DECLARED side's normalizer.
    const live = liveNetwork({
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8:1::/64', '2001:db8::/64'],
        dnsServerIpAddressesOverride: ['2001:4860:4860::8844', '2001:4860:4860::8888'],
      },
    });
    const props: NetworkProps = {
      ...PROPS,
      ipv6Configuration: {
        clientAddressAssignment: { slaacEnabled: true },
        interfaceType: 'ETHERNET',
        additionalHostIpSubnets: ['2001:db8::/64', '2001:db8:1::/64'],
        dnsServerIpAddressesOverride: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
      },
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
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
    expect(driftOf(live, props).some((d) => d.field === 'ipv6Configuration')).toBe(true);
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
