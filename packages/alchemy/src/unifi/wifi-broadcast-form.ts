/**
 * `Unifi.WifiBroadcast`'s wire shape — the declarable subset of `WifiBroadcastOverview`, and how
 * a live read becomes both plan attributes and a rendered declaration.
 *
 * ⛔ T23, THE WHOLE REASON THIS SHAPE DIFFERS FROM EVERY OTHER FAMILY HERE. Every other family's
 *   `*-form.ts` (`network-form.ts`, `dns-policy-form.ts`, …) types its props against the vendor's
 *   CREATE/UPDATE request — the fullest declarable shape, even though this stack never calls it.
 *   `WifiBroadcastProps`/`WifiBroadcastAttributes` do NOT: `securityConfiguration` is typed
 *   `wifiBroadcasts.WifiSecurityConfigurationOverview` — the PAGE OVERVIEW's own type, `{type,
 *   presharedKeyNetworkIds}` — never `WifiSecurityConfigurationDetailObject` (the
 *   `getWifiBroadcastDetails`/create/update shape, which carries `passphrase` and
 *   `radiusConfiguration`). There is no DECLARED field on `WifiSecurityConfigurationOverview` for
 *   `attributesOf`/`declareWifiBroadcast` below to name a passphrase into. See `wifi-broadcast.ts`'s
 *   header for why `fetchLive` can only ever produce a `WifiBroadcastOverview` in the first place
 *   (no get-by-id call exists for it).
 *
 * ⛔ THE TYPE SYSTEM ALONE DOES NOT ENFORCE THIS (red team, IMPORTANT-1, 2026-09-26). `@distilled
 *   .cloud/core`'s wire decode does not strip a key a schema doesn't declare (this file's next
 *   header block); the TS types above describe what a CORRECTLY-shaped response looks like, not
 *   what the decoder actually returns at runtime, so a stray key nested inside `network`,
 *   `hotspotConfiguration`, `broadcastingDeviceFilter`, or an element of `presharedKeyNetworkIds`
 *   would ride along through a naive `{...live}`/pass-through copy exactly like the top-level
 *   `securityConfiguration` object does. `normalizeRef`/`normalizeHotspot`/`normalizeDeviceFilter`
 *   below rebuild EVERY nested object field-by-field for the same reason
 *   `normalizeSecurityConfiguration` does — enumeration, not the type annotation, is what actually
 *   stops it. `wifi-broadcast-secrets.test.ts` plants a sentinel inside each nested shape
 *   (including one `presharedKeyNetworkIds` element) to prove it, not just the top level.
 *
 * ⚠️ EVERY OTHER FIELD REUSES THE SDK'S OWN OVERVIEW TYPES DIRECTLY (`WifiNetworkReference`,
 *   `BroadcastingDeviceFilter`, `IntegrationWifiHotspotConfigurationOverviewDto`) rather than
 *   redeclaring them — same reasoning `network-form.ts` gives for reusing `NetworkDHCPGuarding`/
 *   `NetworkIPv6Configuration` verbatim: one shape to keep in sync with the SDK's own regen.
 *
 * ⛔ THREE FIELDS ARE SETS, NOT SEQUENCES, UNCONFIRMED AGAINST A LIVE CONSOLE (same caveat
 *   `network-form.ts`'s header gives for its own three): `broadcastingDeviceFilter.deviceIds`/
 *   `.deviceTagIds` and `securityConfiguration.presharedKeyNetworkIds` are membership sets by the
 *   vendor description's own wording ("Defines the custom scope of devices…"), not ordered
 *   sequences. `normalizeDeviceFilter`/`normalizeSecurityConfiguration`/`normalizeFrequencies`
 *   neutralize the same "spurious update, refused by a read-only reconcile" failure mode
 *   `network-form.ts`'s header describes, exactly like `firewall-zone-form.ts`'s `networkIds`.
 */
import type * as wifiBroadcasts from '@distilled.cloud/unifi-network/wifi_broadcasts';

const sortedStrings = (values: readonly string[]): string[] => [...new Set(values)].sort();

const sortedFrequencies = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

/** Canonical sort key for a `{type, networkId?}` reference — stable regardless of vendor order. */
const refKey = (ref: wifiBroadcasts.WifiNetworkReference): string =>
  `${ref.type}:${ref.networkId ?? ''}`;

/**
 * Rebuilds a reference field-by-field — never returns the object as received. IMPORTANT-1: this
 * runs on EVERY reference this file handles (`network`, and each `presharedKeyNetworkIds`
 * element) precisely because a reference is exactly the shape (`{network: WifiNetworkReference,
 * passphrase}`) the details call uses to carry a PPSK passphrase (`IntegrationWifiPresharedKeyDto`,
 * SDK `wifi_broadcasts.ts`); it is the most plausible place for a stray passphrase-shaped key to
 * appear on the wire if the vendor ever leaked one onto the overview response.
 */
export const normalizeRef = (
  ref: wifiBroadcasts.WifiNetworkReference | undefined,
): wifiBroadcasts.WifiNetworkReference | undefined =>
  ref === undefined
    ? undefined
    : { type: ref.type, ...(ref.networkId !== undefined ? { networkId: ref.networkId } : {}) };

const sortedRefs = (
  values: readonly wifiBroadcasts.WifiNetworkReference[],
): wifiBroadcasts.WifiNetworkReference[] => {
  const byKey = new Map(
    values.map(
      (ref) => [refKey(ref), normalizeRef(ref) as wifiBroadcasts.WifiNetworkReference] as const,
    ),
  );
  return [...byKey.values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
};

/**
 * Rebuilds the hotspot configuration field-by-field. `IntegrationWifiHotspotConfigurationOverviewDto`
 * declares only `type` (SDK `wifi_broadcasts.ts:743-753`) — a PASSPOINT/RADIUS secret would live on
 * a wire key this type doesn't name, exactly the IMPORTANT-1 risk `normalizeRef` guards against.
 */
export const normalizeHotspot = (
  value: wifiBroadcasts.IntegrationWifiHotspotConfigurationOverviewDto | undefined,
): wifiBroadcasts.IntegrationWifiHotspotConfigurationOverviewDto | undefined =>
  value === undefined ? undefined : { type: value.type };

/**
 * ★ EXPORTED: `wifi-broadcast-drift.ts` reuses these exact normalizers so `matches`/`driftOf` can
 *   never quietly disagree about what counts as a change (MEDIUM-4, `network-drift.ts`'s header).
 *
 * ⛔ NO `{...value}` SPREAD (red team, IMPORTANT-1) — `BroadcastingDeviceFilter` declares exactly
 *   `type`/`deviceIds`/`deviceTagIds` (SDK `wifi_broadcasts.ts:125-129`); enumerating exactly those
 *   three is what stops a stray wire key here, the same reason `normalizeSecurityConfiguration`
 *   (below) never spreads its input.
 */
export const normalizeDeviceFilter = (
  value: wifiBroadcasts.BroadcastingDeviceFilter | undefined,
): wifiBroadcasts.BroadcastingDeviceFilter | undefined =>
  value == null
    ? value
    : {
        type: value.type,
        ...(value.deviceIds !== undefined ? { deviceIds: sortedStrings(value.deviceIds) } : {}),
        ...(value.deviceTagIds !== undefined
          ? { deviceTagIds: sortedStrings(value.deviceTagIds) }
          : {}),
      };

export const normalizeFrequencies = (value: readonly number[] | undefined): number[] | undefined =>
  value === undefined ? value : sortedFrequencies(value);

/**
 * ⛔ NO `{...value}` SPREAD, UNLIKE EVERY OTHER NORMALIZER IN THIS DIRECTORY (`network-form.ts`'s
 *   `normalizeDhcpGuarding`/`normalizeIpv6Configuration` both spread). This is the one field in
 *   the whole `Unifi.*` tree with a spec-confirmed passphrase risk (T23): nothing in
 *   `@distilled.cloud/core`'s wire key-mapping strips an object key the schema doesn't declare —
 *   it only renames declared ones — so a stray extra key on the WIRE `securityConfiguration`
 *   object (a vendor bug, or a future console version) survives `getWifiBroadcastPage`'s own
 *   decode untyped, and `{...value}` would carry it straight through into `Attributes`/`Props`/the
 *   rendered declaration. Enumerating exactly the two fields
 *   `WifiSecurityConfigurationOverview` declares is what actually stops that — proved by
 *   `wifi-broadcast-secrets.test.ts`'s sentinel test, which injects exactly this kind of stray key.
 */
export const normalizeSecurityConfiguration = (
  value: wifiBroadcasts.WifiSecurityConfigurationOverview,
): wifiBroadcasts.WifiSecurityConfigurationOverview => ({
  type: value.type,
  ...(value.presharedKeyNetworkIds !== undefined
    ? { presharedKeyNetworkIds: sortedRefs(value.presharedKeyNetworkIds) }
    : {}),
});

/**
 * ⚠️ EVERY OPTIONAL FIELD SPELLS OUT `| undefined` ON PURPOSE — `exactOptionalPropertyTypes`; see
 *   `network-form.ts`'s own header. `attributesOf`/`declareWifiBroadcast` echo a live optional
 *   field structurally rather than defaulting it, so the target type must admit an explicit
 *   `undefined`.
 */
export interface WifiBroadcastProps {
  siteId: string;
  wifiBroadcastId: string;
  name: string;
  enabled: boolean;
  type: string;
  network?: wifiBroadcasts.WifiNetworkReference | undefined;
  broadcastingDeviceFilter?: wifiBroadcasts.BroadcastingDeviceFilter | undefined;
  broadcastingFrequenciesGHz?: number[] | undefined;
  hotspotConfiguration?: wifiBroadcasts.IntegrationWifiHotspotConfigurationOverviewDto | undefined;
  /** ⛔ T23: the PAGE OVERVIEW's security shape ONLY — see this file's header. */
  securityConfiguration: wifiBroadcasts.WifiSecurityConfigurationOverview;
}

export interface WifiBroadcastAttributes {
  siteId: string;
  wifiBroadcastId: string;
  name: string;
  enabled: boolean;
  type: string;
  network: wifiBroadcasts.WifiNetworkReference | undefined;
  broadcastingDeviceFilter: wifiBroadcasts.BroadcastingDeviceFilter | undefined;
  broadcastingFrequenciesGHz: number[] | undefined;
  hotspotConfiguration: wifiBroadcasts.IntegrationWifiHotspotConfigurationOverviewDto | undefined;
  securityConfiguration: wifiBroadcasts.WifiSecurityConfigurationOverview;
  /** `metadata.origin` — server-derived, never declared; same split as every other family. */
  metadataOrigin: string;
}

export const attributesOf = (
  live: wifiBroadcasts.WifiBroadcastOverview,
  props: WifiBroadcastProps,
): WifiBroadcastAttributes => ({
  siteId: props.siteId,
  wifiBroadcastId: live.id,
  name: live.name,
  enabled: live.enabled,
  type: live.type,
  network: normalizeRef(live.network),
  broadcastingDeviceFilter: normalizeDeviceFilter(live.broadcastingDeviceFilter),
  broadcastingFrequenciesGHz: normalizeFrequencies(live.broadcastingFrequenciesGHz),
  hotspotConfiguration: normalizeHotspot(live.hotspotConfiguration),
  securityConfiguration: normalizeSecurityConfiguration(live.securityConfiguration),
  metadataOrigin: live.metadata.origin,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getWifiBroadcastPage`'s own per-row
 * response straight in and writes the result into `alchemy.run.ts` as `wifiBroadcast('<id>',
 * declareWifiBroadcast(live, siteId))` — no field is invented or defaulted here beyond what
 * `attributesOf` already reports, so `matches(attributesOf(live, props), declareWifiBroadcast(live,
 * siteId))` is `true` by construction (`wifi-broadcast.test.ts` proves it) for any live object
 * this SDK can decode. Builds ONLY from fields `WifiBroadcastOverview` has — never a passphrase,
 * which that type cannot express (see this file's header).
 */
export const declareWifiBroadcast = (
  live: wifiBroadcasts.WifiBroadcastOverview,
  siteId: string,
): WifiBroadcastProps => ({
  siteId,
  wifiBroadcastId: live.id,
  name: live.name,
  enabled: live.enabled,
  type: live.type,
  network: normalizeRef(live.network),
  broadcastingDeviceFilter: normalizeDeviceFilter(live.broadcastingDeviceFilter),
  broadcastingFrequenciesGHz: normalizeFrequencies(live.broadcastingFrequenciesGHz),
  hotspotConfiguration: normalizeHotspot(live.hotspotConfiguration),
  securityConfiguration: normalizeSecurityConfiguration(live.securityConfiguration),
});
