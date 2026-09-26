/**
 * `Unifi.TrafficMatchingList` — one traffic matching list (IPv4/IPv6/port match entries) on a UniFi
 * Network site, READ-ONLY (`policy.ts`).
 *
 * ★ T11 GATE, CHECKED 2026-09-26: `Traffic Matching Lists`' 5 operations are byte-identical between
 *   10.4.57 and 10.6.97, full raw operation objects; the 19-schema closure reachable from all 5
 *   (`$ref` + `discriminator.mapping`) shares zero names with the 14 schemas that DID change
 *   elsewhere in the document. Corroborated independently by the A3 changeset's own broader
 *   25-operation/139-schema re-check (`.changeset/unifi-network-a3-typed-discriminator-filters.md`).
 *   Full breakdown: `docs/unifi-traffic-matching-list.md`.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as trafficMatchingLists from '@distilled.cloud/unifi-network/traffic_matching_lists';
import * as Effect from 'effect/Effect';
import {
  type TrafficMatchingListAttributes,
  type TrafficMatchingListProps,
  attributesOf,
} from './traffic-matching-list-form.ts';
import { matches } from './traffic-matching-list-drift.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type {
  TrafficMatchingListAttributes,
  TrafficMatchingListProps,
} from './traffic-matching-list-form.ts';
export { declareTrafficMatchingList } from './traffic-matching-list-form.ts';
export { driftOf } from './traffic-matching-list-drift.ts';

export interface UnifiTrafficMatchingList extends Resource<
  'Unifi.TrafficMatchingList',
  TrafficMatchingListProps,
  TrafficMatchingListAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiTrafficMatchingList = Resource<UnifiTrafficMatchingList>(
  'Unifi.TrafficMatchingList',
  { defaultRemovalPolicy: 'retain' },
);

/** `trafficMatchingList('office-subnets', props)` — `adopt(true)` piped on by default (H5); see
 *  `network.ts`. */
export const trafficMatchingList = (id: string, props: TrafficMatchingListProps) =>
  UnifiTrafficMatchingList(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  TrafficMatchingListProps,
  trafficMatchingLists.TrafficMatchingList,
  TrafficMatchingListAttributes,
  trafficMatchingLists.GetTrafficMatchingListError
> = {
  type: 'Unifi.TrafficMatchingList',
  describe: (props) =>
    `sites/${props.siteId}/traffic-matching-lists/${props.trafficMatchingListId}`,
  fetchLive: (props) =>
    trafficMatchingLists
      .getTrafficMatchingList({
        siteId: props.siteId,
        trafficMatchingListId: props.trafficMatchingListId,
      })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiTrafficMatchingListProvider = () =>
  Provider.effect(
    UnifiTrafficMatchingList,
    Effect.succeed(UnifiTrafficMatchingList.Provider.of(handlers)),
  );
