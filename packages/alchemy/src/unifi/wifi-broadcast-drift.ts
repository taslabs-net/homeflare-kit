/**
 * `Unifi.WifiBroadcast`'s `matches` AND `driftOf` (B6) — built on the ONE field list below, the
 * same `fieldDrift`-is-the-only-comparison shape `dns-policy-drift.ts`'s header explains
 * (MEDIUM-4): `matches(attrs, props) === (driftOf(live, props).length === 0)` is true BY
 * CONSTRUCTION, never two hand-kept-in-sync comparisons.
 *
 * ★ THREE FIELDS REUSE `wifi-broadcast-form.ts`'s OWN NORMALIZERS ON THE `declared` SIDE TOO, not
 *   just the `live` side — `firewall-zone-form.ts`'s `networkIds` gives the same reason: comparing
 *   a freshly-normalized live value against an un-normalized declared value would report spurious
 *   drift the moment a committed declaration's array happens to be in a different (still valid)
 *   order than what `declareWifiBroadcast` would itself produce today.
 */
import type * as wifiBroadcasts from '@distilled.cloud/unifi-network/wifi_broadcasts';
import { makeDriftOf } from './drift.ts';
import {
  type WifiBroadcastAttributes,
  type WifiBroadcastProps,
  attributesOf,
  normalizeDeviceFilter,
  normalizeFrequencies,
  normalizeSecurityConfiguration,
} from './wifi-broadcast-form.ts';

const fieldDrift = makeDriftOf<WifiBroadcastAttributes, WifiBroadcastProps>([
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'enabled', live: (a) => a.enabled, declared: (p) => p.enabled },
  { field: 'type', live: (a) => a.type, declared: (p) => p.type },
  { field: 'network', live: (a) => a.network, declared: (p) => p.network },
  {
    field: 'broadcastingDeviceFilter',
    live: (a) => a.broadcastingDeviceFilter,
    declared: (p) => normalizeDeviceFilter(p.broadcastingDeviceFilter),
  },
  {
    field: 'broadcastingFrequenciesGHz',
    live: (a) => a.broadcastingFrequenciesGHz,
    declared: (p) => normalizeFrequencies(p.broadcastingFrequenciesGHz),
  },
  {
    field: 'hotspotConfiguration',
    live: (a) => a.hotspotConfiguration,
    declared: (p) => p.hotspotConfiguration,
  },
  {
    field: 'securityConfiguration',
    live: (a) => a.securityConfiguration,
    declared: (p) => normalizeSecurityConfiguration(p.securityConfiguration),
  },
]);

export const matches = (attributes: WifiBroadcastAttributes, props: WifiBroadcastProps): boolean =>
  fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: wifiBroadcasts.WifiBroadcastOverview, props: WifiBroadcastProps) =>
  fieldDrift(attributesOf(live, props), props);
