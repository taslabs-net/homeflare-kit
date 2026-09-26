/**
 * `Unifi.FirewallPolicyOrdering`'s wire shape — ONE resource per `(sourceFirewallZoneId,
 * destinationFirewallZoneId)` ZONE PAIR (`getFirewallPolicyOrdering`'s own scope, `GET
 * /v1/sites/{siteId}/firewall/policies/ordering?sourceFirewallZoneId=…&destinationFirewallZoneId=…`),
 * not per policy and not site-wide. Compare with `acl-rule-ordering-form.ts`'s own header: ACL rule
 * order is ONE list for the whole site because ACL rules have no zone concept; firewall policies are
 * scoped to a zone pair (`firewall-zone.ts`'s own `Unifi.FirewallZone`), so the vendor keys ordering
 * the same way — a console can have as many `Unifi.FirewallPolicyOrdering` resources as it has
 * zone pairs with at least one user-defined policy between them.
 *
 * ⛔ T5 — `beforeSystemDefined`/`afterSystemDefined` ARE EACH A SEQUENCE, NEVER RUN THROUGH
 *   `sortedSet`. `OrderedFirewallPolicyIDs`' own shape splits a zone pair's user-defined policies
 *   into the ones ordered BEFORE the system-defined policies and the ones ordered AFTER them —
 *   within each half, position is priority, the same "lower index/earlier position wins" reasoning
 *   `acl-rule-ordering-form.ts` gives for `orderedAclRuleIds`. `drift.ts`'s `defaultEqual`
 *   (`deepEqual`) already compares arrays element-by-element without sorting them, so leaving both
 *   fields un-normalized is what makes the comparison order-sensitive, not an oversight.
 *
 * ★ TWO SEQUENCES, NOT ONE — the one real difference from `acl-rule-ordering-form.ts`'s single
 *   `orderedAclRuleIds`. A policy ordered "before system-defined" and one ordered "after" can never
 *   swap sides through this endpoint (there is no single combined list position that would let one
 *   policy move from one half to the other) — `matches`/`driftOf` below compare each half
 *   independently, so a policy moving from `beforeSystemDefined` to `afterSystemDefined` reports as
 *   drift on BOTH fields, not a single reordering of one array.
 *
 * ★ `makeDriftOf`, NO CUSTOM `equal` — same framework every other family's `matches`/`driftOf`
 *   share (MEDIUM-4). Its default `deepEqual` is already order-sensitive for arrays, so the absence
 *   of a custom `equal` here is itself the "never sortedSet" rule in force, exactly as
 *   `acl-rule-ordering-form.ts`'s own header explains for its one field.
 */
import type * as firewall from '@distilled.cloud/unifi-network/firewall';
import { makeDriftOf } from './drift.ts';

export interface FirewallPolicyOrderingProps {
  siteId: string;
  sourceFirewallZoneId: string;
  destinationFirewallZoneId: string;
  /** Policy IDs ordered before the zone pair's system-defined policies, highest priority first —
   *  never compared as a set (see header). */
  beforeSystemDefined: string[];
  /** Policy IDs ordered after the zone pair's system-defined policies, highest priority first —
   *  never compared as a set (see header). */
  afterSystemDefined: string[];
}

export interface FirewallPolicyOrderingAttributes {
  siteId: string;
  sourceFirewallZoneId: string;
  destinationFirewallZoneId: string;
  beforeSystemDefined: string[];
  afterSystemDefined: string[];
}

export const attributesOf = (
  live: firewall.IntegrationFirewallPolicyOrderingDto,
  props: FirewallPolicyOrderingProps,
): FirewallPolicyOrderingAttributes => ({
  siteId: props.siteId,
  sourceFirewallZoneId: props.sourceFirewallZoneId,
  destinationFirewallZoneId: props.destinationFirewallZoneId,
  beforeSystemDefined: live.orderedFirewallPolicyIds.beforeSystemDefined,
  afterSystemDefined: live.orderedFirewallPolicyIds.afterSystemDefined,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getFirewallPolicyOrdering`'s own
 * response straight in and writes the result as `firewallPolicyOrdering('<id>',
 * declareFirewallPolicyOrdering(live, siteId, sourceZoneId, destZoneId))` —
 * `matches(attributesOf(live, props), declareFirewallPolicyOrdering(live, …))` is `true` by
 * construction (`firewall-policy-ordering.test.ts` proves it).
 */
export const declareFirewallPolicyOrdering = (
  live: firewall.IntegrationFirewallPolicyOrderingDto,
  siteId: string,
  sourceFirewallZoneId: string,
  destinationFirewallZoneId: string,
): FirewallPolicyOrderingProps => ({
  siteId,
  sourceFirewallZoneId,
  destinationFirewallZoneId,
  beforeSystemDefined: live.orderedFirewallPolicyIds.beforeSystemDefined,
  afterSystemDefined: live.orderedFirewallPolicyIds.afterSystemDefined,
});

const fieldDrift = makeDriftOf<FirewallPolicyOrderingAttributes, FirewallPolicyOrderingProps>([
  {
    field: 'beforeSystemDefined',
    live: (a) => a.beforeSystemDefined,
    declared: (p) => p.beforeSystemDefined,
  },
  {
    field: 'afterSystemDefined',
    live: (a) => a.afterSystemDefined,
    declared: (p) => p.afterSystemDefined,
  },
]);

export const matches = (
  attributes: FirewallPolicyOrderingAttributes,
  props: FirewallPolicyOrderingProps,
): boolean => fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`).
 */
export const driftOf = (
  live: firewall.IntegrationFirewallPolicyOrderingDto,
  props: FirewallPolicyOrderingProps,
) => fieldDrift(attributesOf(live, props), props);
