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
exists on it. `WifiBroadcastProps`/`WifiBroadcastAttributes` (`wifi-broadcast-form.ts`) type
`securityConfiguration` as exactly that overview shape, so there is no field for
`attributesOf`/`declareWifiBroadcast` to even assign a passphrase to — enforced by the type
system, not by a convention someone could forget.

### No get-by-id call exists for the overview shape

Unlike every other family here (`getNetworkDetails`, `getFirewallZone`, `getDnsPolicy`,
`getAclRule`), `wifi_broadcasts.ts` has no single-object GET that returns the overview shape — only
the list (safe) and the details call (forbidden above). `wifi-broadcast.ts`'s `fetchLive` walks
every page with B0b's `pageAll` (`paginate.ts`) and finds the row matching `wifiBroadcastId` — the
first real resource-level consumer of that pager, previously exercised only in isolation by
`paginate.test.ts`. A genuine site-not-found 404 folds to `undefined` like every other family; the
target id simply not being among the collected rows folds to `undefined` too — there is no separate
vendor signal to tell the two apart, and no other family's `fetchLive` has one either.

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
`wifi-broadcast-secrets.test.ts`'s sentinel test proves the pipeline: it injects a raw
`passphrase: SENTINEL` key that genuinely does survive into `live` (asserted directly, not assumed
away), then proves `attributesOf`, `declareWifiBroadcast`, and the literal string a later import
script would render into `alchemy.run.ts` none of them carry it forward.

### The forced decode-failure test

`wifi-broadcast-secrets.test.ts`'s second test sends a non-JSON 200 body (a genuine decode failure
— this SDK's REST decode has no schema-validating step to reject a malformed body with; see
`@distilled.cloud/core`'s `protocol-rest.ts`) that happens to contain a sentinel value, the way a
garbled proxy or debug response might. `pageAll`'s own consistency check (`paginate.ts`) catches it
— the malformed "page" has no `.offset`, so the walk refuses to trust it — and fails typed as
`UnifiPaginationInconsistent`. That error's `reason`/`detail`/`message` are built entirely from
offsets and counts, never from the raw response body, so none of them can ever echo the sentinel
regardless of what garbled text the server sent.

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
