/**
 * A3/T26 regression: the SDK's per-discriminator-typed filters (FirewallPolicy's
 * `protocolFilter`/`macAddressFilter`, an ACL rule's `sourceFilter`/`destinationFilter`) must
 * decode a wire value UNCHANGED — including a key this pinned spec doesn't yet declare.
 *
 * ⛔ WITHOUT THIS TEST, A REGEN THAT SWITCHES `scripts/generate.ts` BACK TO
 *   `unionStyle: "opaque-cases"` STAYS GREEN. That style emits `S.Unknown.pipe(T.UnionCases(...))`,
 *   whose decode (`@distilled.cloud/core` `protocol-http.ts`'s `mapKeys`) picks the best-matching
 *   case by key set and keeps ONLY that case's keys — silently dropping a future vendor field, and
 *   in a same-key-set tie (an all-null MAC endpoint vs. the IP endpoint below) picking the WRONG
 *   case's keys outright. `scripts/generate.ts` now uses Argo CD's `union:` callback instead — a
 *   bare `S.Unknown` with no case annotation — which this repo's own `fake-unifi.ts` proves against
 *   the real wire path (path assembly + JSON decode), the same way `errors-and-secrets.test.ts`
 *   proves A1/A2. This family has no `Unifi.FirewallPolicy`/`Unifi.AclRule` provider yet (Lane B),
 *   so the SDK's own `getAclRule`/`getFirewallPolicy` operations are called directly.
 */
import { describe, expect, test } from 'bun:test';
import * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Effect from 'effect/Effect';
import { fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';

const ACL_PATH = '/proxy/network/integration/v1/sites/site-1/acl-rules/acl-1';
const FW_PATH = '/proxy/network/integration/v1/sites/site-1/firewall/policies/fp-1';

// Fabricated fixture (RFC 5737 address block, RFC 2606-safe ids) — kit is PUBLIC (fake-unifi.ts).
const aclBody = () => ({
  type: 'IPV4',
  id: 'acl-1',
  name: 'example-rule',
  enabled: true,
  action: 'BLOCK',
  index: 0,
  metadata: { origin: 'USER' },
  // A future console version's field this pinned spec has never declared.
  sourceFilter: {
    type: 'IP_ADDRESSES_OR_SUBNETS',
    ipAddressesOrSubnets: ['192.0.2.0/24'],
    futureVendorField: 'unmodeled-by-this-spec-version',
  },
  // Every member null (a same-key-set tie with the IP case under key-set matching).
  destinationFilter: { type: 'MAC_ADDRESSES', macAddresses: null, prefixLength: null },
});

describe('A3/T26 — ACL rule filters decode unchanged, including an unmodeled field', () => {
  test('sourceFilter keeps a key this spec version does not declare', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === ACL_PATH
        ? Response.json(aclBody())
        : new Response('unexpected request', { status: 400 }),
    );
    const live = await Effect.runPromise(
      aclRules
        .getAclRule({ siteId: 'site-1', aclRuleId: 'acl-1' })
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    const source = live.sourceFilter as unknown as Record<string, unknown>;
    expect(source.futureVendorField).toBe('unmodeled-by-this-spec-version');
    expect(source.ipAddressesOrSubnets).toEqual(['192.0.2.0/24']);
  });

  test('destinationFilter is not silently reassigned to the tied IP case', async () => {
    const fake = fakeUnifi(() => Response.json(aclBody()));
    const live = await Effect.runPromise(
      aclRules
        .getAclRule({ siteId: 'site-1', aclRuleId: 'acl-1' })
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    const dest = live.destinationFilter as unknown as Record<string, unknown>;
    expect(dest.type).toBe('MAC_ADDRESSES');
    expect('macAddresses' in dest).toBe(true);
    // The IP case's own keys (`ipAddressesOrSubnets`, `portFilter`, `networkIds`) never appear —
    // the case-narrowing mapKeys path this SDK no longer uses would rewrite them in on a key-set tie.
    expect('ipAddressesOrSubnets' in dest).toBe(false);
  });
});

const fwBody = () => ({
  id: 'fp-1',
  name: 'example-policy',
  enabled: true,
  index: 1,
  action: { type: 'ALLOW' },
  source: {
    zoneId: 'zone-src',
    trafficFilter: {
      type: 'MAC_ADDRESS',
      macAddressFilter: {
        macAddresses: ['02:00:00:00:00:01'],
        futureVendorField: 'unmodeled-by-this-spec-version',
      },
    },
  },
  destination: { zoneId: 'zone-dst' },
  ipProtocolScope: {
    ipVersion: 'IPV6',
    protocolFilter: {
      type: 'NAMED_PROTOCOL',
      protocol: { name: 'icmpv6', typenameFilter: 'ECHO_REQUEST' },
      matchOpposite: false,
      futureVendorField: 'unmodeled-by-this-spec-version',
    },
  },
  metadata: { origin: 'USER' },
  loggingEnabled: false,
});

describe('A3/T26 — FirewallPolicy filters decode unchanged, including an unmodeled field', () => {
  test('macAddressFilter and protocolFilter both keep a key this spec version does not declare', async () => {
    const fake = fakeUnifi((method, url) =>
      method === 'GET' && url.pathname === FW_PATH
        ? Response.json(fwBody())
        : new Response('unexpected request', { status: 400 }),
    );
    const live = await Effect.runPromise(
      firewall
        .getFirewallPolicy({ siteId: 'site-1', firewallPolicyId: 'fp-1' })
        .pipe(Effect.provide(fakeUnifiLayer(fake.fetch))),
    );
    const macFilter = live.source.trafficFilter?.macAddressFilter as unknown as Record<
      string,
      unknown
    >;
    expect(macFilter.futureVendorField).toBe('unmodeled-by-this-spec-version');
    expect(macFilter.macAddresses).toEqual(['02:00:00:00:00:01']);

    const protocolFilter = live.ipProtocolScope.protocolFilter as unknown as Record<
      string,
      unknown
    >;
    expect(protocolFilter.futureVendorField).toBe('unmodeled-by-this-spec-version');
    expect((protocolFilter.protocol as Record<string, unknown>).name).toBe('icmpv6');
  });
});
