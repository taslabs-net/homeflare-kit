/**
 * `Unifi.TrafficMatchingList`'s wire shape — the declarable subset of `TrafficMatchingList`
 * (`getTrafficMatchingList`'s own decode target), and how a live read becomes both plan attributes
 * and a rendered declaration.
 *
 * ★ NO `metadata` FIELD AT ALL — the simplest object shape in this directory. Unlike every other
 *   family here (`FirewallZone`/`DNSPolicy`/`ACLRule`/`FirewallPolicy` all carry a server-derived
 *   `metadata.origin`), `TrafficMatchingList` is just `{id, name, type, items?}` — nothing here is
 *   attributes-only the way `metadataOrigin`/`index` are elsewhere.
 *
 * ★ `items` IS A REAL TS UNION POST-A3, COMPARED WHOLESALE — `Array<IPv4Matching> |
 *   Array<IPv6Matching> | Array<PortMatching>`, keyed by the sibling `type` field
 *   (`traffic_matching_lists.ts`'s own comment: "Shape depends on the sibling discriminator value").
 *   The runtime schema is still a passthrough `S.Unknown` (A3's own changeset: narrower for a reader
 *   at the type level only, so decode keeps every key including one this pinned spec doesn't yet
 *   declare — same proof `discriminated-filter-decode.test.ts` runs for `FirewallPolicy`/`AclRule`).
 *
 * ⚠️ KNOWN GAP (T15, same shape `acl-rule-form.ts`/`firewall-policy-form.ts` both carry): a traffic
 *   matching list's `items` is semantically a SET of match entries (matching is "is this traffic
 *   covered by ANY entry," not order-dependent, unlike `firewall-policy-ordering-form.ts`'s own
 *   sequences), but each entry is an OBJECT (`{type, value?, start?, stop?}`), not a bare string --
 *   there is no cheap canonical sort key the way `sortedSet` gives a `string[]`. `deepEqual` compares
 *   `items` order-sensitively, so a console-side reorder with no membership change would report a
 *   spurious drift this read-only family's `reconcile` then refuses forever. Accepted, not fixed,
 *   same proportion as ACL rule's own nested-filter gap: a generic object-set normalizer is bigger,
 *   separate modelling work, not a mechanical extension of typing `items` per-discriminator (A3).
 */
import type * as trafficMatchingLists from '@distilled.cloud/unifi-network/traffic_matching_lists';

export interface TrafficMatchingListProps {
  siteId: string;
  trafficMatchingListId: string;
  name: string;
  /** Discriminator for `items`' own shape (e.g. an IPv4/IPv6/port list) — the spec enumerates no
   *  fixed value set for it (also accepts a future vendor value it did not enumerate). */
  type: string;
  /** Match entries — a SET semantically, compared wholesale; see the header's known gap. */
  items?: trafficMatchingLists.TrafficMatchingListItems | undefined;
}

export interface TrafficMatchingListAttributes {
  siteId: string;
  trafficMatchingListId: string;
  name: string;
  type: string;
  items: trafficMatchingLists.TrafficMatchingListItems | undefined;
}

export const attributesOf = (
  live: trafficMatchingLists.TrafficMatchingList,
  props: TrafficMatchingListProps,
): TrafficMatchingListAttributes => ({
  siteId: props.siteId,
  trafficMatchingListId: live.id,
  name: live.name,
  type: live.type,
  items: live.items,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getTrafficMatchingList`'s own response
 * straight in and writes the result as `trafficMatchingList('<id>',
 * declareTrafficMatchingList(live, siteId))` — no field is invented or defaulted beyond what
 * `attributesOf` already reports, so `matches(attributesOf(live, props), declareTrafficMatchingList(
 * live, siteId))` is `true` by construction (`traffic-matching-list.test.ts` proves it).
 */
export const declareTrafficMatchingList = (
  live: trafficMatchingLists.TrafficMatchingList,
  siteId: string,
): TrafficMatchingListProps => ({
  siteId,
  trafficMatchingListId: live.id,
  name: live.name,
  type: live.type,
  items: live.items,
});
