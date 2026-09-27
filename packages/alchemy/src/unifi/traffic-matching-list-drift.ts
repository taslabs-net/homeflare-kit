/**
 * `Unifi.TrafficMatchingList`'s `matches` AND `driftOf` (B6) — both built on the ONE field list
 * below, the same `fieldDrift`-is-the-only-comparison shape `network-drift.ts`'s header explains
 * (MEDIUM-4, red team, 2026-09-26): `matches(attrs, props) === (driftOf(live, props).length === 0)`
 * is true BY CONSTRUCTION, never two hand-kept-in-sync comparisons.
 *
 * ⚠️ `stripNullish: true` ON EVERY FIELD BY DEFAULT (`drift.ts`'s `defaultEqual`) — same "UniFi's
 *   JSON answers `null`, a declaration omits" tolerance every other family here relies on.
 * ★ `items` compares with the plain default `equal` (whole-value `deepEqual`) — see
 *   `traffic-matching-list-form.ts`'s header for the accepted known gap this leaves for a
 *   membership-preserving reorder.
 */
import type * as trafficMatchingLists from '@distilled.cloud/unifi-network/traffic_matching_lists';
import { makeDriftOf } from './drift.ts';
import {
  type TrafficMatchingListAttributes,
  type TrafficMatchingListProps,
  attributesOf,
} from './traffic-matching-list-form.ts';

const fieldDrift = makeDriftOf<TrafficMatchingListAttributes, TrafficMatchingListProps>([
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'type', live: (a) => a.type, declared: (p) => p.type },
  { field: 'items', live: (a) => a.items, declared: (p) => p.items },
]);

export const matches = (
  attributes: TrafficMatchingListAttributes,
  props: TrafficMatchingListProps,
): boolean => fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (
  live: trafficMatchingLists.TrafficMatchingList,
  props: TrafficMatchingListProps,
) => fieldDrift(attributesOf(live, props), props);
