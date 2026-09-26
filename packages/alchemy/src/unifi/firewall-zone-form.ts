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
import { makeDriftOf } from './drift.ts';

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
 * B6: the SAME two comparisons `matches` runs above, reused through `makeDriftOf` (`drift.ts`) so
 * the two can never quietly disagree — `matches(attrs, props) === (driftOf(live, props).length
 * === 0)` by construction (`firewall-zone.test.ts` proves it). `networkIds`' custom `equal`
 * mirrors `matches`' own set comparison exactly; its reported `live`/`declared` values are the
 * SORTED arrays, not the joined strings `matches` compares internally, so a real diff reads as a
 * set difference, not two opaque strings.
 */
const fieldDrift = makeDriftOf<FirewallZoneAttributes, FirewallZoneProps>([
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  {
    field: 'networkIds',
    live: (a) => a.networkIds,
    declared: (p) => sortedSet(p.networkIds),
    equal: (live, declared) => (live as string[]).join(',') === (declared as string[]).join(','),
  },
]);

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: firewall.FirewallZone, props: FirewallZoneProps) =>
  fieldDrift(attributesOf(live, props), props);

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
