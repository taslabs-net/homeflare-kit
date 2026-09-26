---
'@homeflare/distilled-unifi-network': minor
---

Regenerated `src/` from the distilled clone's `homeflare/unifi-network` worktree against the pinned
10.4.57 spec (sha256 `3773947b4572b1bdc84272d3d2b9ebb5cad0d9aaa2640c3418568df97c9df59d`, re-verified
2026-09-26; unchanged from the 0.2.0 pin). Two behavioral changes, both read-only-safe (no write path
exists in or through this package):

- **WPA/PPSK `passphrase` now decodes `Redacted.Redacted<string>`, not a plain `string`** (previously
  a plain string on BOTH `IntegrationWifiPresharedKeyDto.passphrase` and the flattened `Wifi security
configuration detailObject.passphrase`). The WiFi details GET returns this value in the clear — the
  pinned spec has no `writeOnly` anywhere on it — and the field's name doesn't match core's generic
  `SENSITIVE_FIELD_PATTERNS`, so `scripts/convert.ts` now passes an explicit `sensitivePatterns:
[...SENSITIVE_FIELD_PATTERNS, /^passphrase$/i]`. Audited every other property name in the pinned
  spec for a secret-shaped field (RADIUS shared secrets, PSKs, API-style keys) while making this
  change: none found — RADIUS security only ever references a profile by `profileId` (a UUID), never
  a shared secret, over this API. Bumped `minor`, not `patch`: a caller currently reading `.passphrase`
  during decode gets a `Redacted` value now, not a plain string, and must unwrap it with
  `Redacted.value()`.
- **`src/protocol.ts`'s `errorEnvelope` now decodes the pinned spec's own `components.schemas["Error
Message"]`** (`{code, message, requestId, requestPath, statusCode, statusName, timestamp}` —
  unreferenced by any operation, previously treated as fully undocumented) instead of always returning
  `undefined`. A failure's `message` is now the vendor's own text instead of a bare `HTTP <status>` on
  every status-mapped error, and `UnknownUnifiNetworkError` gains `requestId`/`statusCode`/
  `statusName`/`timestamp` fields for whatever status falls through to it. `requestPath` is read
  nowhere and never reaches a message or an error field — like the console id/endpoint in
  `src/credentials.ts`, it is caller/console-shaped and must not leak into logged text. This is derived
  from the spec's own schema, not yet confirmed against a real captured failure (no live call was made
  for this work).

Also: `docs/codegen-notes.md`'s "Typed errors" section and the package README's own "write-only"
passphrase claim (both now wrong given the above) are corrected in the distilled clone; this package's
README and CHANGELOG's citations of `docs/codegen-notes.md` — a file the distilled clone has but this
package does not ship — are reworded to say so explicitly instead of pointing at a path that doesn't
exist here.

No wire-shape change: only `passphrase`'s decoded TS type and the error channel's `message`/extra
fields moved. `scripts/generate.ts` gained `memberTraitPipes`/`memberTsType`/`postProcess` (mirroring
Argo CD's `password` handling) — the smithy `sensitive` trait alone does nothing without a provider
opting a pipe/type into it.
