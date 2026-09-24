/**
 * `Unifi.Network`'s wire shape: the declarable subset of `NetworkDetails`, and how a live read
 * becomes both plan attributes and a rendered declaration.
 *
 * ⚠️ PROPS MIRROR `UpdateNetworkRequest`, NOT `NetworkDetails`. `default` and `metadata` are
 *   server-derived — no writable endpoint in `networks.ts` accepts either — so they are
 *   attributes-only, reported but never compared or declared. Everything else in `NetworkProps`
 *   is exactly what `updateNetwork`/`createNetwork` would accept, even though this family never
 *   calls either: the shape is what a future write path would need, and what today's read-only
 *   `matches` compares against.
 *
 * ⛔ `ipv4Configuration` STAYS `unknown`, ON THE SDK'S OWN AUTHORITY. `networks.ts`'s own comment
 *   ("Shape varies by variant — widened by scripts/convert.ts; see README") says the OpenAPI
 *   discriminator this field varies over was flattened at generation time, not decoded per
 *   variant. Comparing it as an opaque JSON value (below) is honest about that; guessing a
 *   narrower shape here would silently stop matching the day a new variant's key order differs.
 *   ⚠️ It may ALSO hide an unordered array the way `dhcpGuarding` and `ipv6Configuration` do
 *   below — this family just can't know, because the shape is never decoded. If a future variant
 *   plans spurious `update`s, suspect this field first and widen it into a typed, order-normalized
 *   shape rather than adding another opaque comparison.
 *
 * ⛔ THREE FIELDS ARE SETS, NOT SEQUENCES: `dhcpGuarding.trustedDhcpServerIpAddresses`,
 *   `ipv6Configuration.additionalHostIpSubnets`, and `ipv6Configuration.dnsServerIpAddressesOverride`.
 *   The vendor document gives no indication any of the three is ordered — same reasoning
 *   `firewall-zone-form.ts` gives for `networkIds`, and `proxmox/user-wire.ts`'s `groupSet` gives
 *   for PVE's `groups` — but `matches` compares via alchemy's `deepEqual`, which sorts object KEYS
 *   but NOT ARRAY ELEMENTS (`node_modules/alchemy/lib/Diff.js`). Left alone, a console that
 *   returns the same set in a different order between calls plans a spurious `update`, and the
 *   read-only reconcile then refuses every deploy. `sortedSet` (dedupe + sort) neutralizes that
 *   before any of the three is attributed, declared, or compared. Every OTHER array field in this
 *   family (there are none today besides these three) would stay declaration-order as written.
 */
import { deepEqual } from 'alchemy/Diff';
import type * as networks from '@distilled.cloud/unifi-network/networks';

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort();

// ⚠️ `value == null` (NOT `=== undefined`) ON PURPOSE, IN BOTH NORMALIZERS BELOW. The SDK types
//   `dhcpGuarding`/`ipv6Configuration` `T | undefined`, but `matches`'s own header says UniFi's
//   JSON answers `null` for an unset optional field — a reality `deepEqual`'s `stripNullish`
//   already treats as equivalent to `undefined` (`value == null` in alchemy's `Diff.js`), which
//   this family's props/attributes types don't model at the TS level. Destructuring a `null` with
//   `=== undefined`'s false branch (`{ ...value, field: value.field }`) would throw
//   `TypeError: Cannot read properties of null` the first time a console omits either field —
//   `== null` catches both and returns the value through untouched, matching what the rest of
//   this file already does for every other optional field.
const normalizeDhcpGuarding = (
  value: networks.NetworkDHCPGuarding | undefined,
): networks.NetworkDHCPGuarding | undefined =>
  value == null
    ? value
    : { ...value, trustedDhcpServerIpAddresses: sortedSet(value.trustedDhcpServerIpAddresses) };

// ⚠️ `exactOptionalPropertyTypes` (see the props header) means these two subfields must be
//   OMITTED, not set to an explicit `undefined`, when the live/declared value has no override —
//   `NetworkIPv6Configuration` types them `field?: T`, not `field?: T | undefined`. Conditional
//   spread (rather than `field: value.field === undefined ? undefined : sortedSet(...)`) is what
//   keeps an absent key absent.
const normalizeIpv6Configuration = (
  value: networks.NetworkIPv6Configuration | undefined,
): networks.NetworkIPv6Configuration | undefined =>
  value == null
    ? value
    : {
        ...value,
        ...(value.additionalHostIpSubnets !== undefined
          ? { additionalHostIpSubnets: sortedSet(value.additionalHostIpSubnets) }
          : {}),
        ...(value.dnsServerIpAddressesOverride !== undefined
          ? { dnsServerIpAddressesOverride: sortedSet(value.dnsServerIpAddressesOverride) }
          : {}),
      };

/**
 * ⚠️ EVERY OPTIONAL FIELD SPELLS OUT `| undefined` ON PURPOSE. `tsconfig.json` sets
 *   `exactOptionalPropertyTypes`, which treats `field?: T` (absent-or-T) and
 *   `field?: T | undefined` (absent-or-explicitly-undefined) as different types. `declareNetwork`
 *   below assigns `live.dhcpGuarding` (typed `T | undefined`) straight through — the whole point
 *   of a renderer that echoes a live optional field structurally rather than defaulting it — so
 *   the target has to admit an explicit `undefined`, not just omission.
 */
export interface NetworkProps {
  siteId: string;
  networkId: string;
  name: string;
  enabled: boolean;
  management: string;
  /** VLAN ID. Must be 1 for the default network and >= 2 for additional networks. */
  vlanId: number;
  dhcpGuarding?: networks.NetworkDHCPGuarding | undefined;
  cellularBackupEnabled?: boolean | undefined;
  internetAccessEnabled?: boolean | undefined;
  /** Opaque — see the header. */
  ipv4Configuration?: unknown;
  ipv6Configuration?: networks.NetworkIPv6Configuration | undefined;
  isolationEnabled?: boolean | undefined;
  mdnsForwardingEnabled?: boolean | undefined;
  zoneId?: string | undefined;
  deviceId?: string | undefined;
}

export interface NetworkAttributes {
  siteId: string;
  networkId: string;
  /** Whether this is the site's undeletable default network — server-derived, never declared. */
  default: boolean;
  name: string;
  enabled: boolean;
  management: string;
  vlanId: number;
  dhcpGuarding: networks.NetworkDHCPGuarding | undefined;
  cellularBackupEnabled: boolean | undefined;
  internetAccessEnabled: boolean | undefined;
  ipv4Configuration: unknown;
  ipv6Configuration: networks.NetworkIPv6Configuration | undefined;
  isolationEnabled: boolean | undefined;
  mdnsForwardingEnabled: boolean | undefined;
  zoneId: string | undefined;
  deviceId: string | undefined;
}

export const attributesOf = (
  live: networks.NetworkDetails,
  props: NetworkProps,
): NetworkAttributes => ({
  siteId: props.siteId,
  networkId: live.id,
  default: live.default,
  name: live.name,
  enabled: live.enabled,
  management: live.management,
  vlanId: live.vlanId,
  dhcpGuarding: normalizeDhcpGuarding(live.dhcpGuarding),
  cellularBackupEnabled: live.cellularBackupEnabled,
  internetAccessEnabled: live.internetAccessEnabled,
  ipv4Configuration: live.ipv4Configuration,
  ipv6Configuration: normalizeIpv6Configuration(live.ipv6Configuration),
  isolationEnabled: live.isolationEnabled,
  mdnsForwardingEnabled: live.mdnsForwardingEnabled,
  zoneId: live.zoneId,
  deviceId: live.deviceId,
});

/**
 * ⚠️ `stripNullish: true` ON EVERY COMPARISON. UniFi's JSON answers `null` for an unset optional
 *   field; a declaration that omits the same prop carries `undefined`. Without this option every
 *   plan against an object with one unset optional field would report `update` forever — the
 *   exact "read and write are different shapes" trap `netbox/values.ts` and `proxmox/user-wire.ts`
 *   both work around, here solved once with the engine's own `deepEqual` instead of a per-field
 *   coercion, because nothing here needs PVE's or NetBox's extra wire-format translation.
 */
export const matches = (attributes: NetworkAttributes, props: NetworkProps): boolean =>
  attributes.name === props.name &&
  attributes.enabled === props.enabled &&
  attributes.management === props.management &&
  attributes.vlanId === props.vlanId &&
  deepEqual(
    normalizeDhcpGuarding(attributes.dhcpGuarding),
    normalizeDhcpGuarding(props.dhcpGuarding),
    {
      stripNullish: true,
    },
  ) &&
  deepEqual(attributes.cellularBackupEnabled, props.cellularBackupEnabled, {
    stripNullish: true,
  }) &&
  deepEqual(attributes.internetAccessEnabled, props.internetAccessEnabled, {
    stripNullish: true,
  }) &&
  deepEqual(attributes.ipv4Configuration, props.ipv4Configuration, { stripNullish: true }) &&
  deepEqual(
    normalizeIpv6Configuration(attributes.ipv6Configuration),
    normalizeIpv6Configuration(props.ipv6Configuration),
    { stripNullish: true },
  ) &&
  deepEqual(attributes.isolationEnabled, props.isolationEnabled, { stripNullish: true }) &&
  deepEqual(attributes.mdnsForwardingEnabled, props.mdnsForwardingEnabled, {
    stripNullish: true,
  }) &&
  deepEqual(attributes.zoneId, props.zoneId, { stripNullish: true }) &&
  deepEqual(attributes.deviceId, props.deviceId, { stripNullish: true });

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getNetworkDetails`'s own response
 * straight in and writes the result into `alchemy.run.ts` as `network('<id>', declareNetwork(live,
 * siteId))` — no field is invented or defaulted here beyond what `attributesOf` already reports,
 * so `matches(attributesOf(live, props), declareNetwork(live, siteId))` is `true` by construction
 * (`network.test.ts` proves it) for any live object this SDK can decode.
 */
export const declareNetwork = (live: networks.NetworkDetails, siteId: string): NetworkProps => ({
  siteId,
  networkId: live.id,
  name: live.name,
  enabled: live.enabled,
  management: live.management,
  vlanId: live.vlanId,
  dhcpGuarding: normalizeDhcpGuarding(live.dhcpGuarding),
  cellularBackupEnabled: live.cellularBackupEnabled,
  internetAccessEnabled: live.internetAccessEnabled,
  ipv4Configuration: live.ipv4Configuration,
  ipv6Configuration: normalizeIpv6Configuration(live.ipv6Configuration),
  isolationEnabled: live.isolationEnabled,
  mdnsForwardingEnabled: live.mdnsForwardingEnabled,
  zoneId: live.zoneId,
  deviceId: live.deviceId,
});
