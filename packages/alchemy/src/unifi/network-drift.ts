/**
 * `Unifi.Network`'s `matches` AND `driftOf` (B6) — both built on the ONE field list below, not two
 * hand-kept-in-sync comparisons. `matches` used to be a separate boolean expression in
 * `network-form.ts`; MEDIUM-4 (red team, 2026-09-26) found that a `fieldDrift` entry could be
 * deleted entirely and every test still passed, because `matches` never consulted `fieldDrift` at
 * all. `matches(attrs, props) === (driftOf(live, props).length === 0)` is now true BY
 * CONSTRUCTION — there is exactly one comparison — and every `fieldDrift` entry names ONE field
 * plus its own live/declared value instead of collapsing straight to a boolean.
 *
 * ⚠️ `stripNullish: true` ON EVERY FIELD BY DEFAULT (`drift.ts`'s `defaultEqual`). UniFi's JSON
 *   answers `null` for an unset optional field; a declaration that omits the same prop carries
 *   `undefined`. Without this, every plan against an object with one unset optional field would
 *   report `update` forever — the exact "read and write are different shapes" trap
 *   `netbox/values.ts` and `proxmox/user-wire.ts` both work around, here solved once by
 *   `makeDriftOf`'s own default instead of a per-field coercion.
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

export const matches = (attributes: NetworkAttributes, props: NetworkProps): boolean =>
  fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: networks.NetworkDetails, props: NetworkProps) =>
  fieldDrift(attributesOf(live, props), props);
