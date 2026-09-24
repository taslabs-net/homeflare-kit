/**
 * `Unifi.FirewallZone`'s wire shape — the declarable subset of `FirewallZone`, and how a live
 * read becomes both plan attributes and a rendered declaration.
 *
 * ⚠️ ONLY `name` AND `networkIds` ARE DECLARABLE. `CreateFirewallZoneRequest`
 *   (`firewall.ts`) accepts exactly those two beyond `siteId`; `metadata` (origin/source) and
 *   `id` are server-derived, so — same split as `network-form.ts`'s `default`/`metadata` —
 *   they are attributes-only, reported but never compared or declared.
 *
 * ⛔ `networkIds` ORDER IS NOT PART OF IDENTITY. The vendor document gives no indication the
 *   list is ordered (it is a set of attached networks, not a sequence like the ordering
 *   endpoints' rule lists), so `matches` compares it as a set — sorted before comparing —
 *   the same reasoning `proxmox/user-wire.ts`'s `groupSet` gives for PVE's `groups`.
 */
import type * as firewall from '@distilled.cloud/unifi-network/firewall';

export interface FirewallZoneProps {
  siteId: string;
  firewallZoneId: string;
  /** Name of a firewall zone. */
  name: string;
  /** Network IDs attached to this zone — compared as a set, see the header. */
  networkIds: string[];
}

export interface FirewallZoneAttributes {
  siteId: string;
  firewallZoneId: string;
  name: string;
  networkIds: string[];
  /** `origin`/`source` (e.g. `SDWAN`) — server-derived, never declared. */
  metadataOrigin: string;
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

export const attributesOf = (
  live: firewall.FirewallZone,
  props: FirewallZoneProps,
): FirewallZoneAttributes => ({
  siteId: props.siteId,
  firewallZoneId: live.id,
  name: live.name,
  networkIds: sortedSet(live.networkIds),
  metadataOrigin: live.metadata.origin,
});

export const matches = (attributes: FirewallZoneAttributes, props: FirewallZoneProps): boolean =>
  attributes.name === props.name &&
  attributes.networkIds.join(',') === sortedSet(props.networkIds).join(',');

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). `matches(attributesOf(live, props), declareFirewallZone(live,
 * siteId))` is `true` by construction (`firewall-zone.test.ts` proves it).
 */
export const declareFirewallZone = (
  live: firewall.FirewallZone,
  siteId: string,
): FirewallZoneProps => ({
  siteId,
  firewallZoneId: live.id,
  name: live.name,
  networkIds: sortedSet(live.networkIds),
});
