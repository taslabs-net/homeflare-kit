/**
 * `Unifi.Network`'s `driftOf` (B6) — split out of `network-form.ts` to keep that file under the
 * house 250-line cap, not because this is a different family: it is the SAME field-by-field
 * comparison `network-form.ts`'s `matches` runs, reused (not re-derived) through `makeDriftOf`
 * (`drift.ts`) so the two can never quietly disagree. `matches(attrs, props) ===
 * (driftOf(live, props).length === 0)` by construction (`network.test.ts` proves it), and every
 * entry names ONE field plus its own live/declared value instead of one collapsed boolean.
 */
import type * as networks from '@distilled.cloud/unifi-network/networks';
import { makeDriftOf } from './drift.ts';
import {
  type NetworkAttributes,
  type NetworkProps,
  attributesOf,
  normalizeDhcpGuarding,
  normalizeIpv6Configuration,
} from './network-form.ts';

const fieldDrift = makeDriftOf<NetworkAttributes, NetworkProps>([
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'enabled', live: (a) => a.enabled, declared: (p) => p.enabled },
  { field: 'management', live: (a) => a.management, declared: (p) => p.management },
  { field: 'vlanId', live: (a) => a.vlanId, declared: (p) => p.vlanId },
  {
    field: 'dhcpGuarding',
    live: (a) => normalizeDhcpGuarding(a.dhcpGuarding),
    declared: (p) => normalizeDhcpGuarding(p.dhcpGuarding),
  },
  {
    field: 'cellularBackupEnabled',
    live: (a) => a.cellularBackupEnabled,
    declared: (p) => p.cellularBackupEnabled,
  },
  {
    field: 'internetAccessEnabled',
    live: (a) => a.internetAccessEnabled,
    declared: (p) => p.internetAccessEnabled,
  },
  {
    field: 'ipv4Configuration',
    live: (a) => a.ipv4Configuration,
    declared: (p) => p.ipv4Configuration,
  },
  {
    field: 'ipv6Configuration',
    live: (a) => normalizeIpv6Configuration(a.ipv6Configuration),
    declared: (p) => normalizeIpv6Configuration(p.ipv6Configuration),
  },
  {
    field: 'isolationEnabled',
    live: (a) => a.isolationEnabled,
    declared: (p) => p.isolationEnabled,
  },
  {
    field: 'mdnsForwardingEnabled',
    live: (a) => a.mdnsForwardingEnabled,
    declared: (p) => p.mdnsForwardingEnabled,
  },
  { field: 'zoneId', live: (a) => a.zoneId, declared: (p) => p.zoneId },
  { field: 'deviceId', live: (a) => a.deviceId, declared: (p) => p.deviceId },
]);

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: networks.NetworkDetails, props: NetworkProps) =>
  fieldDrift(attributesOf(live, props), props);
