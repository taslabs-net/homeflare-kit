/**
 * `Unifi.FirewallPolicy` — one firewall policy on a UniFi Network site, READ-ONLY (`policy.ts`).
 * `Unifi.FirewallPolicyOrdering` (`firewall-policy-ordering.ts`) is the sibling resource for policy
 * ORDER within a zone pair (T5) — one per `(sourceFirewallZoneId, destinationFirewallZoneId)`, never
 * this file's concern. `docs/unifi.md`'s own header names this pair as "a bigger, separate PR";
 * this is that PR — see `docs/unifi-firewall-policy.md` for the full breakdown.
 *
 * ★ T11 GATE, CHECKED 2026-09-26: the `Firewall` tag's 13 operations (5 already covered for
 *   `Unifi.FirewallZone` in `docs/unifi.md`, 8 new here for `FirewallPolicy` — `getFirewallPolicies`,
 *   `createFirewallPolicy`, `getFirewallPolicyOrdering`, `updateFirewallPolicyOrdering`,
 *   `deleteFirewallPolicy`, `getFirewallPolicy`, `patchFirewallPolicy`, `updateFirewallPolicy`) are
 *   byte-identical between 10.4.57 and 10.6.97, full raw operation objects; the 106-schema closure
 *   reachable from all 13 (`$ref` + `discriminator.mapping`) shares zero names with the 14 schemas
 *   that DID change elsewhere in the document. Corroborated independently by the A3 changeset's own
 *   broader 25-operation/139-schema re-check (`.changeset/unifi-network-a3-typed-discriminator-filters.md`).
 *   Full breakdown: `docs/unifi-firewall-policy.md`.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Effect from 'effect/Effect';
import {
  type FirewallPolicyAttributes,
  type FirewallPolicyProps,
  attributesOf,
} from './firewall-policy-form.ts';
import { matches } from './firewall-policy-drift.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { FirewallPolicyAttributes, FirewallPolicyProps } from './firewall-policy-form.ts';
export { declareFirewallPolicy } from './firewall-policy-form.ts';
export { driftOf } from './firewall-policy-drift.ts';

export interface UnifiFirewallPolicy extends Resource<
  'Unifi.FirewallPolicy',
  FirewallPolicyProps,
  FirewallPolicyAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiFirewallPolicy = Resource<UnifiFirewallPolicy>('Unifi.FirewallPolicy', {
  defaultRemovalPolicy: 'retain',
});

/** `firewallPolicy('block-iot-wan', props)` — `adopt(true)` piped on by default (H5); see
 *  `network.ts`. */
export const firewallPolicy = (id: string, props: FirewallPolicyProps) =>
  UnifiFirewallPolicy(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  FirewallPolicyProps,
  firewall.FirewallPolicy,
  FirewallPolicyAttributes,
  firewall.GetFirewallPolicyError
> = {
  type: 'Unifi.FirewallPolicy',
  describe: (props) => `sites/${props.siteId}/firewall/policies/${props.firewallPolicyId}`,
  fetchLive: (props) =>
    firewall
      .getFirewallPolicy({ siteId: props.siteId, firewallPolicyId: props.firewallPolicyId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiFirewallPolicyProvider = () =>
  Provider.effect(UnifiFirewallPolicy, Effect.succeed(UnifiFirewallPolicy.Provider.of(handlers)));
