# UniFi WiFi Broadcasts — `Unifi.WifiBroadcast`

⛔ **READ-ONLY, BY TIM'S RULE (2026-09-24).** Same posture as `docs/unifi.md`'s `Unifi.Network`/
`Unifi.FirewallZone`: `reconcile`/`delete` both fail with a typed `UnifiWriteRefused`, and the
`GetOnlyHttpClient` wire guard (`resource.ts`) refuses any non-`GET` request before it reaches the
transport. This family calls no SDK write op anywhere — `write-op-reference.test.ts` proves it
statically, and `wifi-broadcast.test.ts`'s own write-path tests prove `reconcile`/`destroy` never
send anything but `GET`s.

## T23: the passphrase-bearing details call is never made

The pinned spec's WiFi Broadcast "details" shape (`getWifiBroadcastDetails`, and the create/update
request bodies) — `WifiSecurityConfigurationDetailObject` — carries the WPA passphrase AND every
PPSK entry's own passphrase, with **no `writeOnly` flag on either** (verified: 4 `passphrase`
properties, 0 `writeOnly` flags, in the staged 10.4.57 spec). `README.md`'s claim that these fields
are "write-only" was wrong; A2 (kit PR #300) fixed the SDK layer by decoding them `Redacted`
instead of a plain string, proven at the wire in `errors-and-secrets.test.ts`.

This family goes further and **never calls that shape at all.** The only SDK call
`wifi-broadcast.ts` makes is `getWifiBroadcastPage` — the LIST endpoint, which answers
`WifiBroadcastOverview` rows. That type's own `securityConfiguration`
(`WifiSecurityConfigurationOverview`) is `{type, presharedKeyNetworkIds}`: no passphrase field
exists on it, so there is no DECLARED field for `attributesOf`/`declareWifiBroadcast` to name a
passphrase into. A static guard (`wifi-broadcast-details-call.test.ts`) additionally bans any
source reference to `getWifiBroadcastDetails` itself under `src/unifi` (red team, IMPORTANT-2),
with one named exception: `errors-and-secrets.test.ts` (A2) calls it directly on purpose, to prove
the SDK's own redaction happens at the wire — a different, lower-layer claim than this family ever
needing to make that call.

⛔ **This is NOT enforced by the type system alone** (red team, IMPORTANT-1) — corrected from an
earlier version of this doc that overclaimed it was. `@distilled.cloud/core`'s wire decode does not
strip a key a schema doesn't declare, so a stray key nested inside `network`, `hotspotConfiguration`,
`broadcastingDeviceFilter`, or one `presharedKeyNetworkIds` element could ride through a naive
pass-through exactly like the top-level `securityConfiguration` object could. See "The stray-key
defense" below — enumeration at runtime, not the TS annotation, is what actually stops it.

### No get-by-id call exists for the overview shape

Unlike every other family here (`getNetworkDetails`, `getFirewallZone`, `getDnsPolicy`,
`getAclRule`), `wifi_broadcasts.ts` has no single-object GET that returns the overview shape — only
the list (safe) and the details call (forbidden above). `wifi-broadcast.ts`'s `fetchLive` walks
every page with B0b's `pageAll` (`paginate.ts`) and finds the row matching `wifiBroadcastId` — the
first real resource-level consumer of that pager, previously exercised only in isolation by
`paginate.test.ts`. A genuine site-not-found 404 on ANY page of the walk — not only the first —
folds to `undefined` like every other family, discarding whatever rows the walk had already
collected (red team, MINOR-4: an earlier version of this doc said "on the first page call", which
overstated how narrowly the catch is scoped); the target id simply not being among the collected
rows folds to `undefined` too — there is no separate vendor signal to tell any of these cases apart,
and no other family's `fetchLive` has one either.

### The stray-key defense (why `normalizeSecurityConfiguration` never spreads)

Nothing in `@distilled.cloud/core`'s wire key-mapping strips an object key the schema does not
declare — it only renames declared ones (measured directly against the installed
`@distilled.cloud/core@1.0.0-rc.12`: a struct decode keeps every key from the raw response,
declared or not). So a stray `passphrase`-shaped key on the WIRE `securityConfiguration` object — a
vendor bug, or a future console version — physically survives into the `live` object `fetchLive`
returns, even though `WifiBroadcastOverview`'s own TS type has no such field.

`wifi-broadcast-form.ts`'s `normalizeSecurityConfiguration` is the one normalizer in this whole
`Unifi.*` tree that does **not** use `{...value}` (every sibling normalizer, `network-form.ts`'s
included, spreads its input). It enumerates exactly `{type, presharedKeyNetworkIds}` instead —
`attributesOf`/`declareWifiBroadcast` are built the same way, field by field, never `{...live}`.

⛔ **The same discipline applies to every OTHER nested object this family handles, not just
`securityConfiguration`** (red team, IMPORTANT-1) — `normalizeRef` rebuilds `network` and each
`presharedKeyNetworkIds` element as `{type, networkId?}`, `normalizeHotspot` rebuilds
`hotspotConfiguration` as `{type}`, and `normalizeDeviceFilter` no longer spreads
`broadcastingDeviceFilter` either. A `presharedKeyNetworkIds` element is the single most plausible
leak site of the four: `IntegrationWifiPresharedKeyDto`, the details-call shape for a PPSK entry, is
literally `{network: WifiNetworkReference, passphrase}` — the same reference shape this family's
overview also uses, just with one more field the overview type doesn't declare.

`wifi-broadcast-secrets.test.ts`'s sentinel tests prove the pipeline for all five locations
(`securityConfiguration`, a `presharedKeyNetworkIds` element, `network`, `hotspotConfiguration`,
`broadcastingDeviceFilter`): each plants a raw sentinel key that genuinely does survive into `live`
(asserted directly, not assumed away), then proves `attributesOf`, `declareWifiBroadcast`, and the
literal string a later import script would render into `alchemy.run.ts` none of them carry it
forward.

### The forced decode-failure test

`wifi-broadcast-secrets.test.ts`'s decode-failure test sends a non-JSON 200 body (a genuine decode
failure — this SDK's REST decode has no schema-validating step to reject a malformed body with; see
`@distilled.cloud/core`'s `protocol-rest.ts`) that happens to contain a sentinel value, the way a
garbled proxy or debug response might. `pageAll`'s own consistency check (`paginate.ts`) catches it
— the malformed "page" has no `.offset`, so the walk refuses to trust it — and fails typed as
`UnifiPaginationInconsistent`. That error's `reason`/`detail`/`message` are built from `offset`/
`totalCount` values run through `paginate.ts`'s `numOrPlaceholder` (red team, MINOR-3: an earlier
version of this doc said these fields were "never from the raw response body", but `offset`/
`totalCount` themselves ARE unvalidated wire values — `paginate.test.ts`'s own test proves a
non-numeric one renders as a fixed placeholder, never as itself), so none of them can ever echo
attacker- or vendor-controlled text regardless of what the server actually sent.

## Field-level drift

Three fields are membership SETS, not ordered sequences, by the vendor description's own wording
("Defines the custom scope of devices…") and unconfirmed against a live console (same caveat
`network-form.ts` carries for its own three): `broadcastingDeviceFilter.deviceIds`/`.deviceTagIds`
and `securityConfiguration.presharedKeyNetworkIds`. `wifi-broadcast-form.ts`'s
`normalizeDeviceFilter`/`normalizeSecurityConfiguration`/`normalizeFrequencies` sort+dedupe them
before comparison, on both the live AND declared sides (`wifi-broadcast-drift.ts`), the same
`firewall-zone-form.ts`'s `networkIds` pattern — otherwise a console returning the same set in a
different order would plan a spurious `update` that a read-only `reconcile` then refuses.

`wifi-broadcast.ts` exports a pure `driftOf(live, props)`, built on `drift.ts`'s `makeDriftOf`
framework. `matches` is exactly `fieldDrift(...).length === 0` (MEDIUM-4).

## The declaration renderer

`declareWifiBroadcast(live, siteId)` is a pure function: given one `WifiBroadcastOverview` row (as
`getWifiBroadcastPage` returns it, never `getWifiBroadcastDetails`), it returns the `Props` a
declaration needs so its plan is a no-op. A later import script pages every WiFi broadcast on a
site and writes one `wifiBroadcast('<id>', declareWifiBroadcast(live, siteId))` row per result —
nothing here performs that write.

## Vendor version

UniFi Network Integration API **10.4.57**, same pin as `docs/unifi.md`, via
`@distilled.cloud/unifi-network` aliased onto `@homeflare/distilled-unifi-network@0.3.0`.
