---
'@homeflare/distilled-unifi-network': minor
---

Regenerated `src/` from the distilled clone's `homeflare/unifi-network` worktree (commit `b15b9603`)
against the pinned 10.4.57 spec (sha256 `3773947b4572b1bdc84272d3d2b9ebb5cad0d9aaa2640c3418568df97c9df59d`,
re-verified 2026-09-26; unchanged from the 0.2.0 pin). Three behavioral changes, all read-only-safe (no
write path exists in or through this package):

- **WPA/PPSK `passphrase` now decodes `Redacted.Redacted<string>`, not a plain `string`** (previously
  a plain string on BOTH `IntegrationWifiPresharedKeyDto.passphrase` and the flattened `Wifi security
configuration detailObject.passphrase`). The WiFi details GET returns this value in the clear — the
  pinned spec has no `writeOnly` anywhere on it — and the field's name doesn't match core's generic
  `SENSITIVE_FIELD_PATTERNS`, so `scripts/convert.ts` now passes an explicit `sensitivePatterns:
[...SENSITIVE_FIELD_PATTERNS, /^passphrase$/i]`. Bumped `minor`, not `patch`: a caller currently
  reading `.passphrase` during decode gets a `Redacted` value now, not a plain string, and must unwrap
  it with `Redacted.value()`.
- **Hotspot voucher `code` now decodes `Redacted` too**, found while auditing the rest of the spec for
  secret-shaped fields: `components.schemas["Hotspot voucher details"].properties.code` is documented
  as "Secret code to active the voucher using the Hotspot portal", but `code` also names two harmless
  schemas (`Error Message`, `Country Definition`) — a name pattern would over-redact. Fixed with a
  targeted spec patch instead (`patches/hotspot/voucher-code-sensitive.json`, `x-sensitive: true`),
  which the converter's `isSensitiveProperty` honors ahead of any name pattern; no generator change
  needed. No kit provider reads this family yet, so nothing currently carries it into state. RADIUS
  security was also audited and only ever references a profile by `profileId` (a UUID), never a shared
  secret, over this API — no other property name in the spec matches
  `secret`/`psk`/`presharedkey`/`radius.*key`.
- **`src/protocol.ts`'s `errorEnvelope` now decodes the pinned spec's own `components.schemas["Error
Message"]`** (`{code, message, requestId, requestPath, statusCode, statusName, timestamp}` —
  unreferenced by any operation, previously treated as fully undocumented) instead of always returning
  `undefined`. A mapped status (e.g. `NotFound`) now carries the vendor's own `message` text instead of
  a bare `HTTP <status>`, but NOT `code`/`requestId`/`statusName`/`timestamp` — core's shared
  `HTTP_STATUS_MAP` dispatch keeps only `message` for a mapped class. Those extra fields survive only
  on `UnknownUnifiNetworkError`, the fallback for a status the map doesn't cover. `requestPath` is
  read nowhere and never reaches a message or a typed error field — like the console id/endpoint in
  `src/credentials.ts`, it is caller/console-shaped and must not leak into logged text; it does still
  sit, un-plucked, inside `UnknownUnifiNetworkError.body` for anyone who reads that raw value on
  purpose. This is derived from the spec's own schema, not yet confirmed against a real captured
  failure (no live call was made for this work).

Also: `docs/codegen-notes.md`'s "Typed errors" section and the package README's own "write-only"
passphrase claim (both now wrong given the above) are corrected in the distilled clone; this package's
README and CHANGELOG's citations of `docs/codegen-notes.md` — a file the distilled clone has but this
package does not ship — are reworded to say so explicitly instead of pointing at a path that doesn't
exist here. A `DISTILLED_DEBUG_HTTP=1` session bypasses every redaction above — core prints the raw
response body to stderr before any decode runs — never set that flag against a real console.

No wire-shape change beyond the two `Redacted` fields above: the error channel's `message`/extra
fields moved, nothing about request shape did. `scripts/generate.ts` gained
`memberTraitPipes`/`memberTsType`/`postProcess` (mirroring Argo CD's `password` handling) — the smithy
`sensitive` trait alone does nothing without a provider opting a pipe/type into it. New test coverage:
`packages/alchemy/src/unifi/errors-and-secrets.test.ts` exercises both the passphrase redaction and
the error envelope decode through the real fake-fetch path, so a future regen that drops either
regresses a test instead of staying green.
