/**
 * I1 (red team, 2026-09-26, PR 309 LAND): every fixture in `firewall-policy.test.ts` and
 * `firewall-policy-drift.test.ts` uses filter-LESS `source`/`destination`/`ipProtocolScope`
 * (`{zoneId}`/`{ipVersion}` only). A mutant that made `attributesOf`/`declareFirewallPolicy` write
 * only those two keys -- silently dropping every `trafficFilter`/`protocolFilter`/`schedule` --
 * passed all of `firewall-policy.test.ts` AND `discriminated-filter-decode.test.ts` (17/17). The
 * latter proves the SDK's OWN decode keeps every key; it never reads them back through THIS
 * resource's `attributesOf`/`declareFirewallPolicy`, which is the actual path a Lane C import walks.
 *
 * This file is that missing link: a filter-bearing wire body, read through `spec.fetchLive`, then
 * `declareFirewallPolicy` -- proving the filters (plus a key this pinned spec has never declared)
 * survive THIS round trip, not just the SDK's own decode.
 *
 * Split from `firewall-policy-drift.test.ts` to keep that file under the house 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { attributesOf } from './firewall-policy-form.ts';
import { driftOf, matches } from './firewall-policy-drift.ts';
import { type FirewallPolicyProps, declareFirewallPolicy, spec } from './firewall-policy.ts';

const FILTER_POLICY_PATH = '/proxy/network/integration/v1/sites/site-1/firewall/policies/fp-2';

// Fabricated fixture (RFC 5737/2606-safe) -- kit is PUBLIC. Every compound field here actually
// carries a filter, plus one key ("futureVendorField") this pinned spec doesn't declare.
const filterBearingWireBody = () => ({
  id: 'fp-2',
  name: 'Allow specific IPs to the internet',
  enabled: true,
  index: 5,
  action: { type: 'ALLOW' },
  connectionStateFilter: null,
  description: null,
  ipsecFilter: null,
  loggingEnabled: false,
  metadata: { origin: 'USER' },
  source: {
    zoneId: 'zone-src',
    trafficFilter: {
      type: 'NETWORK',
      networkFilter: { matchOpposite: false, networkIds: ['net-1', 'net-2'] },
      portFilter: {
        matchOpposite: false,
        type: 'PORT',
        items: [{ type: 'PORT_SINGLE', value: 443 }],
      },
    },
  },
  destination: {
    zoneId: 'zone-dst',
    trafficFilter: {
      type: 'IP_ADDRESS',
      ipAddressFilter: {
        matchOpposite: false,
        type: 'IP_ADDRESS',
        items: [{ type: 'IP_SINGLE_ADDRESS', value: '203.0.113.5' }],
      },
    },
  },
  ipProtocolScope: {
    ipVersion: 'IPV4_AND_IPV6',
    protocolFilter: {
      type: 'PRESET',
      preset: 'ALL',
      matchOpposite: false,
      futureVendorField: 'unmodeled-by-this-spec-version',
    },
  },
  schedule: {
    mode: 'EVERY_WEEK',
    repeatOnDays: ['MONDAY', 'FRIDAY'],
    timeFilter: { startTime: '08:00', stopTime: '18:00' },
  },
});

const BASE_PROPS: FirewallPolicyProps = {
  siteId: 'site-1',
  firewallPolicyId: 'fp-2',
  action: { type: 'ALLOW' },
  destination: { zoneId: 'zone-dst' },
  enabled: true,
  ipProtocolScope: { ipVersion: 'IPV4' },
  loggingEnabled: false,
  name: 'placeholder',
  source: { zoneId: 'zone-src' },
};

describe('I1 -- a filter-bearing policy round-trips through declareFirewallPolicy', () => {
  test('source.trafficFilter, destination.trafficFilter, ipProtocolScope.protocolFilter and schedule survive, unknown key included', async () => {
    const wire = filterBearingWireBody();
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === FILTER_POLICY_PATH
        ? Response.json(wire)
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(BASE_PROPS).pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    if (live == null) throw new Error('expected a live FirewallPolicy');
    const declared = declareFirewallPolicy(live, 'site-1');

    // Cast both sides to `Record<string, unknown>` -- the declared side's real type is a narrow
    // per-discriminator union (A3), and `wire`'s own object-literal type widens each string
    // property; comparing them as unions vs literals is not the point of this assertion, VALUE
    // equality (including the unmodeled key below) is.
    const asRecord = (value: unknown) => value as Record<string, unknown>;
    expect(asRecord(declared.source.trafficFilter)).toEqual(asRecord(wire.source.trafficFilter));
    expect(asRecord(declared.destination.trafficFilter)).toEqual(
      asRecord(wire.destination.trafficFilter),
    );
    expect(asRecord(declared.ipProtocolScope.protocolFilter)).toEqual(
      asRecord(wire.ipProtocolScope.protocolFilter),
    );
    expect(asRecord(declared.schedule)).toEqual(asRecord(wire.schedule));
    // The key this pinned spec has never declared -- proves the mutant this test targets (silently
    // narrowing to `{zoneId}`/`{ipVersion}`) can't hide behind a fixture with nothing to drop.
    expect(asRecord(declared.ipProtocolScope.protocolFilter).futureVendorField).toBe(
      'unmodeled-by-this-spec-version',
    );

    const attrs = attributesOf(live, declared);
    expect(matches(attrs, declared)).toBe(true);
    expect(driftOf(live, declared)).toEqual([]);

    // A nested change inside ONE compound field reports that field, and only that field.
    const changedDestination: FirewallPolicyProps = {
      ...declared,
      destination: {
        zoneId: 'zone-dst',
        trafficFilter: {
          type: 'IP_ADDRESS',
          ipAddressFilter: {
            matchOpposite: false,
            type: 'IP_ADDRESS',
            items: [{ type: 'IP_SINGLE_ADDRESS', value: '203.0.113.99' }],
          },
        },
      },
    };
    expect(driftOf(live, changedDestination).map((d) => d.field)).toEqual(['destination']);
  });
});
