/**
 * `Unifi.AclRule`'s wire shape — the declarable subset of `ACLRule` (`getAclRule`'s own decode
 *   target — `ACLRuleObject` is the structurally-identical page-list item type, unused here), and
 *   how a live read
 * becomes both plan attributes and a rendered declaration. Rule ORDER is a separate resource
 * (`acl-rule-ordering.ts`, T5) — this file is one rule's own fields only.
 *
 * ⚠️ `sourceFilter`/`destinationFilter` STAY `unknown`, ON THE SDK'S OWN AUTHORITY.
 *   `access_control_acl_rules.ts`'s own comment on both ("Shape varies by variant — widened by
 *   scripts/convert.ts; see README") says the OpenAPI discriminator these vary over was flattened
 *   at generation time (T10), same as `network-form.ts`'s `ipv4Configuration`. A3 (typing these
 *   per-discriminator) is scoped OUT of this PR — see the plan's family inventory — so both stay
 *   opaque JSON, compared with plain `deepEqual`, honest about not being decoded.
 *
 * ⛔ `index` IS ATTRIBUTES-ONLY, NEVER DECLARED. `CreateAclRuleRequest`'s own field comment:
 *   "ACL rule index. This property is deprecated and has no effect. Use the dedicated ACL rule
 *   reordering endpoint." The live object's current position is `acl-rule-ordering.ts`'s concern
 *   (`ACLRuleOrdering.orderedAclRuleIds`), not this resource's declared identity — reporting it
 *   here without comparing it avoids a field that can never converge under this family's own
 *   `matches` (nothing here could ever change it) from silently pretending to be declarable.
 *
 * ⛔ `enforcingDeviceFilter.deviceIds` AND `protocolFilter` ARE SETS, NOT SEQUENCES — same
 *   reasoning `firewall-zone-form.ts` gives for `networkIds`: "IDs of the Switch-capable devices
 *   used to enforce the ACL rule" and "Protocols this ACL rule will be applied to" both describe
 *   membership, with no indication either list is ordered like `acl-rule-ordering.ts`'s rule-id
 *   sequence. Left alone, a console that returns either in a different order between calls would
 *   plan a spurious `update` that this read-only family's `reconcile` then refuses forever.
 */
import type * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** ★ EXPORTED so `acl-rule-drift.ts` normalizes both live and declared sides identically — see
 *  `network-form.ts`'s own header for why a normalizer applied to only one side is a bug class. */
export const normalizeDeviceFilter = (
  value: aclRules.ACLRuleDeviceFilter | undefined,
): aclRules.ACLRuleDeviceFilter | undefined =>
  value == null
    ? value
    : {
        ...value,
        ...(value.deviceIds !== undefined ? { deviceIds: sortedSet(value.deviceIds) } : {}),
      };

export const normalizeProtocolFilter = (
  value: readonly string[] | undefined,
): string[] | undefined => (value == null ? undefined : sortedSet(value));

/** ⚠️ EVERY OPTIONAL FIELD SPELLS OUT `| undefined` — `exactOptionalPropertyTypes`; see
 *  `network-form.ts`'s own header. */
export interface AclRuleProps {
  siteId: string;
  aclRuleId: string;
  /** `ALLOW` or `BLOCK` (also accepts a future vendor value the spec did not enumerate). */
  action: string;
  description?: string | undefined;
  /** Traffic destination filter — opaque, see the header. */
  destinationFilter?: unknown;
  enabled: boolean;
  /** Devices enforcing this rule — compared as a SET, see the header. */
  enforcingDeviceFilter?: aclRules.ACLRuleDeviceFilter | undefined;
  name: string;
  /** Traffic source filter — opaque, see the header. */
  sourceFilter?: unknown;
  type: string;
  /** Protocols this rule applies to — compared as a SET, see the header. */
  protocolFilter?: string[] | undefined;
  networkIdFilter?: string | undefined;
}

export interface AclRuleAttributes {
  siteId: string;
  aclRuleId: string;
  action: string;
  description: string | undefined;
  destinationFilter: unknown;
  enabled: boolean;
  enforcingDeviceFilter: aclRules.ACLRuleDeviceFilter | undefined;
  /** ACL rule index (current priority position) — server-derived, never declared; see header. */
  index: number;
  name: string;
  sourceFilter: unknown;
  type: string;
  protocolFilter: string[] | undefined;
  networkIdFilter: string | undefined;
  /** `metadata.origin` — server-derived, never declared; see `firewall-zone-form.ts`'s own. */
  metadataOrigin: string;
}

export const attributesOf = (live: aclRules.ACLRule, props: AclRuleProps): AclRuleAttributes => ({
  siteId: props.siteId,
  aclRuleId: live.id,
  action: live.action,
  description: live.description,
  destinationFilter: live.destinationFilter,
  enabled: live.enabled,
  enforcingDeviceFilter: normalizeDeviceFilter(live.enforcingDeviceFilter),
  index: live.index,
  name: live.name,
  sourceFilter: live.sourceFilter,
  type: live.type,
  protocolFilter: normalizeProtocolFilter(live.protocolFilter),
  networkIdFilter: live.networkIdFilter,
  metadataOrigin: live.metadata.origin,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getAclRule`'s own response straight in
 * and writes the result as `aclRule('<id>', declareAclRule(live, siteId))` — no field is invented
 * or defaulted beyond what `attributesOf` already reports, so `matches(attributesOf(live, props),
 * declareAclRule(live, siteId))` is `true` by construction (`acl-rule.test.ts` proves it).
 */
export const declareAclRule = (live: aclRules.ACLRule, siteId: string): AclRuleProps => ({
  siteId,
  aclRuleId: live.id,
  action: live.action,
  description: live.description,
  destinationFilter: live.destinationFilter,
  enabled: live.enabled,
  enforcingDeviceFilter: normalizeDeviceFilter(live.enforcingDeviceFilter),
  name: live.name,
  sourceFilter: live.sourceFilter,
  type: live.type,
  protocolFilter: normalizeProtocolFilter(live.protocolFilter),
  networkIdFilter: live.networkIdFilter,
});
