/**
 * `Unifi.DnsPolicy` — one DNS policy on a UniFi Network site, READ-ONLY (`policy.ts`).
 *
 * ★ T11 GATE, CHECKED 2026-09-26, CORRECTED SAME DAY (red team, Important finding 1): `DNS
 *   Policies` is 5 operations, `Access Control (ACL Rules)` (`acl-rule.ts`) is 7 — 12 total.
 *   Diffed the pinned 10.4.57 spec against a 10.6.97 mirror (`beezly/unifi-apis`, diffing aid
 *   only, `docs/unifi-acl-rule.md` records the sha256 + mirror commit): all 12 full operation
 *   objects (parameters, request body, responses, unresolved `$ref`s included) are byte-identical
 *   across versions. ⚠️ The schema closure is 46, not 17 — a `$ref`-only walk misses every schema
 *   reachable only via a `discriminator.mapping` (both `DNS policy` and `ACL rule` discriminate on
 *   `type`); the 46-schema closure, `$ref` + `mapping` together, shares zero names with the 14
 *   schemas that DID change between the two versions (all in `Switching`, `Filtering`, or one
 *   `UniFi Devices` enum — none of it DNS- or ACL-shaped). Same reachability method
 *   `spec-version-provenance.md` (distilled package) used for Networks/FirewallZones, extended to
 *   follow `mapping` too; full breakdown in `docs/unifi-acl-rule.md`, not repeated per family.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as dnsPolicies from '@distilled.cloud/unifi-network/dns_policies';
import * as Effect from 'effect/Effect';
import { type DnsPolicyAttributes, type DnsPolicyProps, attributesOf } from './dns-policy-form.ts';
import { matches } from './dns-policy-drift.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { DnsPolicyAttributes, DnsPolicyProps } from './dns-policy-form.ts';
export { declareDnsPolicy } from './dns-policy-form.ts';
export { driftOf } from './dns-policy-drift.ts';

export interface UnifiDnsPolicy extends Resource<
  'Unifi.DnsPolicy',
  DnsPolicyProps,
  DnsPolicyAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiDnsPolicy = Resource<UnifiDnsPolicy>('Unifi.DnsPolicy', {
  defaultRemovalPolicy: 'retain',
});

/** `dnsPolicy('lan-forwarding', props)` — `adopt(true)` piped on by default (H5); see `network.ts`. */
export const dnsPolicy = (id: string, props: DnsPolicyProps) =>
  UnifiDnsPolicy(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  DnsPolicyProps,
  dnsPolicies.DNSPolicy,
  DnsPolicyAttributes,
  dnsPolicies.GetDnsPolicyError
> = {
  type: 'Unifi.DnsPolicy',
  describe: (props) => `sites/${props.siteId}/dns/policies/${props.dnsPolicyId}`,
  fetchLive: (props) =>
    dnsPolicies
      .getDnsPolicy({ siteId: props.siteId, dnsPolicyId: props.dnsPolicyId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiDnsPolicyProvider = () =>
  Provider.effect(UnifiDnsPolicy, Effect.succeed(UnifiDnsPolicy.Provider.of(handlers)));
