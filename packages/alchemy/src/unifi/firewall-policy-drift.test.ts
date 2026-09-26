/**
 * `Unifi.FirewallPolicy`'s `driftOf`/`matches` (`firewall-policy-drift.ts`, B6) — split out of
 * `firewall-policy.test.ts` to keep that file under the house 250-line cap once this coverage grew,
 * same split `network-drift.test.ts` is from `network.test.ts`, not a different family.
 *
 * The last `describe` closes red-team finding I2 (2026-09-26, PR 309 LAND): `firewall-policy-
 * drift.ts`'s field list is untyped strings (`makeDriftOf`'s own contract) — deleting any 7 of its
 * 11 entries left every test in `firewall-policy.test.ts` green. `DECLARABLE_FIELDS` below is a
 * `Record<..., true>` keyed by `Exclude<keyof FirewallPolicyProps, 'siteId' | 'firewallPolicyId'>`
 * — adding or removing a `FirewallPolicyProps` field without updating that record is a TYPE ERROR,
 * so the list this test walks is complete BY CONSTRUCTION. Changing exactly one field at a time and
 * asserting `driftOf` reports exactly that field's name means a field missing from the real
 * `fieldDrift` array (as the red-team mutant produced) shows up here as "reports []" instead of
 * "reports [field]" — the same failure the red team's own by-hand deletion produced, now a standing
 * test instead of a one-off probe.
 *
 * I1 (the filter-bearing-policy round trip) lives in `firewall-policy-filter-roundtrip.test.ts` —
 * a third split, not folded in here, to keep this file under the cap too.
 */
import { describe, expect, test } from 'bun:test';
import type * as firewall from '@distilled.cloud/unifi-network/firewall';
import { attributesOf } from './firewall-policy-form.ts';
import { driftOf, matches } from './firewall-policy-drift.ts';
import type { FirewallPolicyProps } from './firewall-policy.ts';

const liveFirewallPolicy = (
  overrides: Partial<firewall.FirewallPolicy> = {},
): firewall.FirewallPolicy => ({
  action: { type: 'ALLOW' },
  connectionStateFilter: ['ESTABLISHED', 'RELATED'],
  description: 'Allow IoT devices outbound to the internet',
  destination: { zoneId: 'zone-external' },
  enabled: true,
  id: 'fp-1',
  index: 3,
  ipProtocolScope: { ipVersion: 'IPV4' },
  loggingEnabled: false,
  metadata: { origin: 'USER' },
  name: 'Allow IoT to Internet',
  source: { zoneId: 'zone-iot' },
  ...overrides,
});

const PROPS: FirewallPolicyProps = {
  siteId: 'site-1',
  firewallPolicyId: 'fp-1',
  action: { type: 'ALLOW' },
  connectionStateFilter: ['ESTABLISHED', 'RELATED'],
  description: 'Allow IoT devices outbound to the internet',
  destination: { zoneId: 'zone-external' },
  enabled: true,
  ipProtocolScope: { ipVersion: 'IPV4' },
  loggingEnabled: false,
  name: 'Allow IoT to Internet',
  source: { zoneId: 'zone-iot' },
};

describe('driftOf -- B6 field-level drift, straight from one live read', () => {
  test('a real name change reports its own field, live and declared', () => {
    const live = liveFirewallPolicy({ name: 'Allow IoT outbound' });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'name', live: 'Allow IoT outbound', declared: 'Allow IoT to Internet' },
    ]);
  });

  test('connectionStateFilter in a different order is a noop -- it is a SET, not a sequence', () => {
    const live = liveFirewallPolicy({ connectionStateFilter: ['RELATED', 'ESTABLISHED'] });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(true);
    expect(driftOf(live, PROPS)).toEqual([]);
  });

  test('the DECLARED side of connectionStateFilter is also normalized (MEDIUM-4 mutant)', () => {
    const live = liveFirewallPolicy({ connectionStateFilter: ['ESTABLISHED', 'RELATED'] });
    const props: FirewallPolicyProps = {
      ...PROPS,
      connectionStateFilter: ['RELATED', 'ESTABLISHED'],
    };
    expect(matches(attributesOf(live, props), props)).toBe(true);
    expect(driftOf(live, props)).toEqual([]);
  });

  test('a genuine connectionStateFilter difference is caught', () => {
    const live = liveFirewallPolicy({ connectionStateFilter: ['NEW'] });
    expect(driftOf(live, PROPS)).toEqual([
      { field: 'connectionStateFilter', live: ['NEW'], declared: ['ESTABLISHED', 'RELATED'] },
    ]);
  });

  test('index is never compared -- it is attributes-only, owned by FirewallPolicyOrdering', () => {
    const live = liveFirewallPolicy({ index: 41 });
    expect(matches(attributesOf(live, PROPS), PROPS)).toBe(true);
    expect(attributesOf(live, PROPS).index).toBe(41);
  });

  test('source/destination compare wholesale -- a real zone change is still caught', () => {
    const live = liveFirewallPolicy({ destination: { zoneId: 'zone-guest' } });
    expect(driftOf(live, PROPS)).toEqual([
      {
        field: 'destination',
        live: { zoneId: 'zone-guest' },
        declared: { zoneId: 'zone-external' },
      },
    ]);
  });
});

type DeclarableField = Exclude<keyof FirewallPolicyProps, 'siteId' | 'firewallPolicyId'>;

const DECLARABLE_FIELDS: Record<DeclarableField, true> = {
  action: true,
  connectionStateFilter: true,
  description: true,
  destination: true,
  enabled: true,
  ipProtocolScope: true,
  ipsecFilter: true,
  loggingEnabled: true,
  name: true,
  schedule: true,
  source: true,
};

/** One changed value per field -- distinct enough from PROPS' own that `deepEqual` calls it drift,
 *  and (for `enabled`/`loggingEnabled`) not merely `undefined` vs a value, which `stripNullish`
 *  would treat as a noop. */
const CHANGED_VALUE: { [K in DeclarableField]: FirewallPolicyProps[K] } = {
  action: { type: 'BLOCK' },
  connectionStateFilter: ['NEW'],
  description: 'a different description',
  destination: { zoneId: 'zone-different' },
  enabled: false,
  ipProtocolScope: { ipVersion: 'IPV6' },
  ipsecFilter: 'MATCH_ENCRYPTED',
  loggingEnabled: true,
  name: 'a different name',
  schedule: { mode: 'EVERY_DAY' },
  source: { zoneId: 'zone-different-2' },
};

describe('I2 -- every declarable field is wired into the drift field list', () => {
  // `liveFirewallPolicy()` (no overrides) matches PROPS field-for-field (proved above), so
  // changing exactly one PROPS field per case isolates that field's own wire-up.
  test.each(Object.keys(DECLARABLE_FIELDS) as DeclarableField[])(
    'changing only %s reports exactly that field',
    (field) => {
      const live = liveFirewallPolicy();
      const changedProps: FirewallPolicyProps = { ...PROPS, [field]: CHANGED_VALUE[field] };
      expect(driftOf(live, changedProps).map((d) => d.field)).toEqual([field]);
    },
  );
});
