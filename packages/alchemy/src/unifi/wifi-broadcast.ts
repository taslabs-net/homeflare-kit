/**
 * `Unifi.WifiBroadcast` — one WiFi network (SSID) broadcast on a UniFi Network site, READ-ONLY
 * (`policy.ts`).
 *
 * ⛔ T23, THE REASON THIS FAMILY NEVER CALLS `getWifiBroadcastDetails`. That single-object GET
 *   returns `WifiBroadcastDetails`, whose `securityConfiguration`
 *   (`WifiSecurityConfigurationDetailObject`) carries the WPA passphrase AND every PPSK entry's
 *   passphrase — the pinned spec has NO `writeOnly` flag on either (verified: 4 `passphrase`
 *   props, 0 `writeOnly`; A2 already redacts them to `Redacted.Redacted<string>` at the SDK layer,
 *   `errors-and-secrets.test.ts`). This family goes further and never fetches that shape AT ALL:
 *   the only call below is `getWifiBroadcastPage`, which answers `WifiBroadcastOverview` instead —
 *   whose own `securityConfiguration` (`WifiSecurityConfigurationOverview`) is `{type,
 *   presharedKeyNetworkIds}`. No passphrase field exists in that type, so `WifiBroadcastProps`/
 *   `Attributes` (`wifi-broadcast-form.ts`) cannot carry one even by a future mistake.
 *
 * ⚠️ NO GET-BY-ID CALL EXISTS FOR THE OVERVIEW SHAPE — unlike every other family in this
 *   directory (`getNetworkDetails`, `getFirewallZone`, `getDnsPolicy`, `getAclRule`),
 *   `wifi_broadcasts.ts` only has `getWifiBroadcastPage` (list) and `getWifiBroadcastDetails`
 *   (single, passphrase-bearing — forbidden above). `fetchLive` below walks every page with B0b's
 *   `pageAll` and finds the one row matching `wifiBroadcastId` — the first real resource-level
 *   consumer of that pager (previously exercised only by `paginate.test.ts` in isolation). A
 *   genuine site-not-found 404 on the first page call folds to `undefined` like every other
 *   family; the broadcast simply not being among the collected rows folds to `undefined` too — the
 *   list has no separate "not found" signal to distinguish the two, and neither does any other
 *   family's `fetchLive`.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as wifiBroadcasts from '@distilled.cloud/unifi-network/wifi_broadcasts';
import * as Effect from 'effect/Effect';
import {
  type WifiBroadcastAttributes,
  type WifiBroadcastProps,
  attributesOf,
} from './wifi-broadcast-form.ts';
import { matches } from './wifi-broadcast-drift.ts';
import { type UnifiPaginationInconsistent, pageAll } from './paginate.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { WifiBroadcastAttributes, WifiBroadcastProps } from './wifi-broadcast-form.ts';
export { declareWifiBroadcast } from './wifi-broadcast-form.ts';
export { driftOf } from './wifi-broadcast-drift.ts';

export interface UnifiWifiBroadcast extends Resource<
  'Unifi.WifiBroadcast',
  WifiBroadcastProps,
  WifiBroadcastAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiWifiBroadcast = Resource<UnifiWifiBroadcast>('Unifi.WifiBroadcast', {
  defaultRemovalPolicy: 'retain',
});

/** `wifiBroadcast('guest', props)` — `adopt(true)` piped on by default (H5); see `network.ts`. */
export const wifiBroadcast = (id: string, props: WifiBroadcastProps) =>
  UnifiWifiBroadcast(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  WifiBroadcastProps,
  wifiBroadcasts.WifiBroadcastOverview,
  WifiBroadcastAttributes,
  wifiBroadcasts.GetWifiBroadcastPageError | UnifiPaginationInconsistent
> = {
  type: 'Unifi.WifiBroadcast',
  describe: (props) => `sites/${props.siteId}/wifi/broadcasts/${props.wifiBroadcastId}`,
  fetchLive: (props) =>
    pageAll(wifiBroadcasts.getWifiBroadcastPage, { siteId: props.siteId }).pipe(
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
      Effect.map((rows) => rows?.find((row) => row.id === props.wifiBroadcastId)),
    ),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiWifiBroadcastProvider = () =>
  Provider.effect(UnifiWifiBroadcast, Effect.succeed(UnifiWifiBroadcast.Provider.of(handlers)));
