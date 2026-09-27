# @homeflare/distilled-unifi-network

## 0.3.0

### Minor Changes

- [#300](https://github.com/taslabs-net/homeflare-kit/pull/300) [`dd7e853`](https://github.com/taslabs-net/homeflare-kit/commit/dd7e853843d7a49a8c1c3dca1d3116753c3752aa) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Regenerated `src/` from the distilled clone's `homeflare/unifi-network` worktree (commit `b15b9603`)
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

## 0.2.0

### Minor Changes

- [#196](https://github.com/taslabs-net/homeflare-kit/pull/196) [`58d81b3`](https://github.com/taslabs-net/homeflare-kit/commit/58d81b3276ff828c0484610d566209a02bf700a3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-unifi-network`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/unifi-network` SDK — 73 operations
  across 44 paths (13 API tags), generated from Ubiquiti's own UniFi Network
  **Integration API** OpenAPI 3.1.0 document (10.4.57; the vendor publishes no
  stable, anonymously-fetchable spec URL, so this copy is an operator export
  from a console's own web UI, with its `servers` block already stripped — a
  console's `servers[0].url` embeds an account-identifying console id that
  must never be committed). ~67 of the spec's polymorphic (discriminator +
  `allOf`) schemas are flattened into optional fields on their base, since the
  spec has zero `oneOf`/`anyOf` for the generator to hook a union into; the
  spec documents zero error responses on any operation, so every operation's
  error channel is the shared HTTP-status-dispatched set instead.

  Follows the interim-package route `@homeflare/distilled-netbox` ([#183](https://github.com/taslabs-net/homeflare-kit/issues/183)),
  `@homeflare/distilled-proxmox` ([#185](https://github.com/taslabs-net/homeflare-kit/issues/185)) and `@homeflare/distilled-paperless-ngx`
  ([#188](https://github.com/taslabs-net/homeflare-kit/issues/188)) already established — see
  `packages/alchemy/docs/distilled-interim.md`. This PR does not alias
  `@distilled.cloud/unifi-network` onto it and adds no kit provider — the
  alias can only resolve once this package is actually on npm, and a UniFi
  provider family is its own follow-up work. The package's own README records
  the resource-level traps (whole-object PUT, ordering-list endpoints,
  adopt-only objects, hardware-affecting writes) a future provider must not
  ignore — full detail lives in the distilled clone's
  `packages/unifi-network/docs/codegen-notes.md`, which is NOT copied into
  this package (only `src/` is) — and the `X-API-KEY` header this SDK sends
  is unverified against a live console — this PR ships a separate, unrun
  auth-probe handoff script for that.
