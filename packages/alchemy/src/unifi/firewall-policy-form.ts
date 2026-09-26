/**
 * `Unifi.FirewallPolicy`'s wire shape — the declarable subset of `FirewallPolicy` (`getFirewallPolicy`'s
 * own decode target), and how a live read becomes both plan attributes and a rendered declaration.
 * Rule ORDER is a separate resource (`firewall-policy-ordering.ts`, T5) — this file is one policy's
 * own fields only.
 *
 * ★ `source`/`destination`/`ipProtocolScope`/`action`/`schedule` STAY COMPOUND, COMPARED WHOLESALE —
 *   post-A3 (`8ee11f1`, "type FirewallPolicy/ACL/TrafficMatchingList filters per discriminator"),
 *   these decode as real per-discriminator TS unions instead of `unknown`
 *   (`discriminated-filter-decode.test.ts` proves the wire path keeps every key, including one this
 *   pinned spec doesn't yet declare), so this file is honest about their real shape rather than
 *   casting to `unknown` the way `acl-rule-form.ts` still does for its own opaque filters. It does
 *   NOT follow that up with a leaf-by-leaf declarable schema for all 12 filter variants, though:
 *   that is new modelling work this PR does not attempt, so each field is compared with plain
 *   `deepEqual` (`stripNullish`) as ONE value, same proportion `acl-rule-form.ts`'s
 *   `enforcingDeviceFilter` gets (one level of structure, not exploded into scalars).
 *
 * ⚠️ KNOWN GAP (T15, same shape as `acl-rule-form.ts`'s own — accepted, not fixed, here either):
 *   several of the vendor's filter variants nested inside `source`/`destination`/`ipProtocolScope`
 *   are themselves SET-LIKE arrays with no documented order —
 *   `FirewallPolicyMACAddressFilter.macAddresses`, `FirewallPolicyNetworkFilter.networkIds`,
 *   `FirewallPolicyApplicationFilter.applicationIds`, `FirewallPolicyIPAddressFilter.items`,
 *   `FirewallPolicyRegionFilter.regions`, `FirewallPolicyVPNServerFilter.vpnServerIds`,
 *   `FirewallSchedule.repeatOnDays` — `deepEqual` compares every one of them order-sensitively, so a
 *   console-side reorder with no membership change would report a spurious drift this read-only
 *   family's `reconcile` then refuses forever. Not fixed here for the same reason ACL's own gap
 *   isn't: normalizing 12 filter variants' own nested arrays is a bigger, separate change, not a
 *   proportional extension of typing per-discriminator (A3) into set-aware comparison too.
 *
 * ⛔ `connectionStateFilter` IS THE ONE TOP-LEVEL PROPS ARRAY, AND IS A SET — "Match on firewall
 *   connection state. If null, matches all connection states" describes membership, not a sequence
 *   (unlike `firewall-policy-ordering-form.ts`'s own `beforeSystemDefined`/`afterSystemDefined`,
 *   where position IS the value). Normalized with the same `sortedSet` every other family in this
 *   directory uses for a set-shaped array (`firewall-zone-form.ts`'s `networkIds`,
 *   `acl-rule-form.ts`'s `protocolFilter`).
 *
 * ⛔ `index` IS ATTRIBUTES-ONLY, NEVER DECLARED. `CreateFirewallPolicyRequest` has no `index`
 *   field at all — the live object's current position among ALL policies on the site is reported,
 *   but a policy's PRIORITY relative to its own zone pair is `firewall-policy-ordering.ts`'s concern
 *   (`OrderedFirewallPolicyIDs`), same split `acl-rule-form.ts`'s own `index` documents.
 *
 * ⛔ `metadata.origin` IS ATTRIBUTES-ONLY, same split every other family here uses
 *   (`firewall-zone-form.ts`'s `metadataOrigin`) — `UserOrSystemDefinedOrDerivedEntityMetadata` is
 *   server-derived, no writable field accepts it.
 */
import type * as firewall from '@distilled.cloud/unifi-network/firewall';

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** ★ EXPORTED so `firewall-policy-drift.ts` normalizes both live and declared sides identically —
 *  see `acl-rule-form.ts`'s own header for why a normalizer applied to only one side is a bug
 *  class (MEDIUM-4). */
export const normalizeConnectionStateFilter = (
  value: readonly string[] | undefined,
): string[] | undefined => (value == null ? undefined : sortedSet(value));

/** ⚠️ EVERY OPTIONAL FIELD SPELLS OUT `| undefined` — `exactOptionalPropertyTypes`; see
 *  `network-form.ts`'s own header. */
export interface FirewallPolicyProps {
  siteId: string;
  firewallPolicyId: string;
  action: firewall.FirewallPolicyAction;
  /** Connection states this policy matches — compared as a SET, see the header. */
  connectionStateFilter?: string[] | undefined;
  description?: string | undefined;
  /** Traffic destination — compound, compared wholesale; see the header's known gap. */
  destination: firewall.FirewallPolicyDestination;
  enabled: boolean;
  /** IP version + protocol scope — compound, compared wholesale; see the header's known gap. */
  ipProtocolScope: firewall.FirewallPolicyIPProtocolScope;
  ipsecFilter?: string | undefined;
  loggingEnabled: boolean;
  name: string;
  /** Schedule this policy is active on — compound, compared wholesale; see the header's known gap. */
  schedule?: firewall.FirewallSchedule | undefined;
  /** Traffic source — compound, compared wholesale; see the header's known gap. */
  source: firewall.FirewallPolicySource;
}

export interface FirewallPolicyAttributes {
  siteId: string;
  firewallPolicyId: string;
  action: firewall.FirewallPolicyAction;
  connectionStateFilter: string[] | undefined;
  description: string | undefined;
  destination: firewall.FirewallPolicyDestination;
  enabled: boolean;
  /** Current position among ALL policies on the site — server-derived, never declared; see header. */
  index: number;
  ipProtocolScope: firewall.FirewallPolicyIPProtocolScope;
  ipsecFilter: string | undefined;
  loggingEnabled: boolean;
  name: string;
  schedule: firewall.FirewallSchedule | undefined;
  source: firewall.FirewallPolicySource;
  /** `metadata.origin` — server-derived, never declared; see `firewall-zone-form.ts`'s own. */
  metadataOrigin: string;
}

export const attributesOf = (
  live: firewall.FirewallPolicy,
  props: FirewallPolicyProps,
): FirewallPolicyAttributes => ({
  siteId: props.siteId,
  firewallPolicyId: live.id,
  action: live.action,
  connectionStateFilter: normalizeConnectionStateFilter(live.connectionStateFilter),
  description: live.description,
  destination: live.destination,
  enabled: live.enabled,
  index: live.index,
  ipProtocolScope: live.ipProtocolScope,
  ipsecFilter: live.ipsecFilter,
  loggingEnabled: live.loggingEnabled,
  name: live.name,
  schedule: live.schedule,
  source: live.source,
  metadataOrigin: live.metadata.origin,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getFirewallPolicy`'s own response
 * straight in and writes the result as `firewallPolicy('<id>', declareFirewallPolicy(live, siteId))`
 * — no field is invented or defaulted beyond what `attributesOf` already reports, so
 * `matches(attributesOf(live, props), declareFirewallPolicy(live, siteId))` is `true` by
 * construction (`firewall-policy.test.ts` proves it).
 */
export const declareFirewallPolicy = (
  live: firewall.FirewallPolicy,
  siteId: string,
): FirewallPolicyProps => ({
  siteId,
  firewallPolicyId: live.id,
  action: live.action,
  connectionStateFilter: normalizeConnectionStateFilter(live.connectionStateFilter),
  description: live.description,
  destination: live.destination,
  enabled: live.enabled,
  ipProtocolScope: live.ipProtocolScope,
  ipsecFilter: live.ipsecFilter,
  loggingEnabled: live.loggingEnabled,
  name: live.name,
  schedule: live.schedule,
  source: live.source,
});
