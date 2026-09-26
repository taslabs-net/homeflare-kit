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

/**
 * B6: `fieldDrift` (`makeDriftOf`, `drift.ts`) is now the ONLY comparison this family has — MEDIUM-4
 * (red team, 2026-09-26): a hand-written `matches` kept beside `fieldDrift` is two field lists an
 * edit to one can silently leave out of sync with the other (a mutant deleting a `fieldDrift` entry
 * left every test green, because `matches` never consulted it). `matches(attrs, props) ===
 * (driftOf(live, props).length === 0)` is now true BY CONSTRUCTION, not just by a test that happens
 * to check both. `networkIds`' custom `equal` is the set comparison the family has always used —
 * see the header — and its reported `live`/`declared` values in a `driftOf` result are the SORTED
 * arrays, not the joined strings this `equal` compares internally, so a real diff reads as a set
 * difference, not two opaque strings.
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

export const matches = (attributes: FirewallZoneAttributes, props: FirewallZoneProps): boolean =>
  fieldDrift(attributes, props).length === 0;

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
