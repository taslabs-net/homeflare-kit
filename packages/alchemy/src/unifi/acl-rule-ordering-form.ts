/**
 * `Unifi.AclRuleOrdering`'s wire shape — ONE resource per site (`getAclRuleOrdering`'s own scope,
 * `GET /v1/sites/{siteId}/acl-rules/ordering`), not per rule. Compare with `firewall-zone-form.ts`'s
 * `networkIds`, which is a genuine SET: this file's `orderedAclRuleIds` is the opposite case.
 *
 * ⛔ T5 — `orderedAclRuleIds` IS A SEQUENCE, NEVER RUN THROUGH `sortedSet`. The endpoint's own name
 *   (`updateAclRuleOrdering`) and its field's own vendor comment on `ACLRule.index` ("Lower index
 *   has higher priority") both say this list's POSITION is the entire value it carries — rule
 *   priority. `firewall-zone-form.ts`'s `sortedSet`/`network-form.ts`'s three set normalizers all
 *   exist to stop the OPPOSITE mistake (treating a set as if order mattered); applying the same
 *   fix here would silently discard the one thing this resource represents. `drift.ts`'s
 *   `defaultEqual` (`deepEqual`) already compares arrays element-by-element without sorting them
 *   (its header: "sorts object KEYS but NOT ARRAY ELEMENTS") — so leaving this field un-normalized
 *   is what makes the comparison order-sensitive, not an oversight to "fix" later.
 *
 * ★ `makeDriftOf` (`drift.ts`), NO CUSTOM `equal` — same framework every other family's
 *   `matches`/`driftOf` share (MEDIUM-4). Its default `deepEqual` is ALREADY order-sensitive for
 *   arrays (see the paragraph above), so the absence of a custom `equal` here, unlike
 *   `firewall-zone-form.ts`'s `networkIds` entry, is itself the "never sortedSet" rule in force —
 *   not an oversight.
 */
import type * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import { makeDriftOf } from './drift.ts';

export interface AclRuleOrderingProps {
  siteId: string;
  /** Rule IDs in priority order, highest priority first — never compared as a set (see header). */
  orderedAclRuleIds: string[];
}

export interface AclRuleOrderingAttributes {
  siteId: string;
  orderedAclRuleIds: string[];
}

export const attributesOf = (
  live: aclRules.ACLRuleOrdering,
  props: AclRuleOrderingProps,
): AclRuleOrderingAttributes => ({
  siteId: props.siteId,
  orderedAclRuleIds: live.orderedAclRuleIds,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getAclRuleOrdering`'s own response
 * straight in and writes the result as `aclRuleOrdering('site-1', declareAclRuleOrdering(live,
 * siteId))` — `matches(attributesOf(live, props), declareAclRuleOrdering(live, siteId))` is `true`
 * by construction (`acl-rule-ordering.test.ts` proves it).
 */
export const declareAclRuleOrdering = (
  live: aclRules.ACLRuleOrdering,
  siteId: string,
): AclRuleOrderingProps => ({
  siteId,
  orderedAclRuleIds: live.orderedAclRuleIds,
});

const fieldDrift = makeDriftOf<AclRuleOrderingAttributes, AclRuleOrderingProps>([
  {
    field: 'orderedAclRuleIds',
    live: (a) => a.orderedAclRuleIds,
    declared: (p) => p.orderedAclRuleIds,
  },
]);

export const matches = (
  attributes: AclRuleOrderingAttributes,
  props: AclRuleOrderingProps,
): boolean => fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`). Only one field exists, so this either reports nothing or the whole
 * ordered pair, never a per-position breakdown -- a future consumer wanting "which rule moved"
 * would need to diff the two arrays itself.
 */
export const driftOf = (live: aclRules.ACLRuleOrdering, props: AclRuleOrderingProps) =>
  fieldDrift(attributesOf(live, props), props);
