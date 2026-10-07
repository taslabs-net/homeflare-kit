# @homeflare/distilled-unifi-network

## 0.4.1

### Patch Changes

- [#359](https://github.com/taslabs-net/homeflare-kit/pull/359) [`f43b0a5`](https://github.com/taslabs-net/homeflare-kit/commit/f43b0a5673d3660181b3dc7eb5342096c67cd38c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move to effect and `@effect/*` 4.0.1, alchemy 2.0.0-beta.81 and `@distilled.cloud/*` 1.0.0-rc.13. Consumers must install effect 4.0.1 (the peer was an exact rc.115): every import path moves from `effect/unstable/*` to `effect/*`. The distilled packages implement the `parseError` option distilled core rc.13 now requires of a REST protocol, raising each package's own `<Sdk>ParseError`. alchemy beta.81 probes a create whose props were Outputs at apply, so the ownership layer now answers `Unowned` to that apply-time read unless the plan proved the resume, forgets the row the engine's refusal leaves behind, and `Release.Binary` judges that create as a create: another owner's object, or other bytes at a binary path, are still refused without `--adopt`. `@homeflare/config` publishes the new `ESTATE_VERSIONS`.

## 0.4.0

### Minor Changes

- [#304](https://github.com/taslabs-net/homeflare-kit/pull/304) [`8ee11f1`](https://github.com/taslabs-net/homeflare-kit/commit/8ee11f14cb449d6c6e8396d0dad25292565bbff7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Regenerated `src/` from the distilled clone's `homeflare/unifi-network` worktree against the pinned
  10.4.57 spec (sha256 `3773947b4572b1bdc84272d3d2b9ebb5cad0d9aaa2640c3418568df97c9df59d`, unchanged from
  the last regen). One behavioral change, read-only-safe (no write path exists in or through this
  package): three field groups whose per-variant shape IS the field's whole value now decode a real TS
  union instead of opaque `unknown`.

  - **`FirewallPolicyIPProtocolScope.protocolFilter`** → `FirewallPolicyIPv4Protocol |
FirewallPolicyIPv4AndIPv6Protocol | FirewallPolicyIPv6Protocol`. The vendor's `discriminator.mapping`
    keys this by the SIBLING `ipVersion` field on the parent, not by anything on `protocolFilter` itself —
    all 3 cases share an identical key set, so this is a type-level distinction only.
  - **`FirewallPolicySourceTrafficFilter.macAddressFilter`** → `string | FirewallPolicyMACAddressFilter`
    — a bare MAC string when matching additionally by MAC on a non-MAC filter, the full
    `{macAddresses}` object when the filter's own `type` is `"MAC_ADDRESS"`.
  - **`ACLRule`/`ACLRuleObject`'s `source`/`destinationFilter`, and `CreateAclRuleRequest`/
    `UpdateAclRuleRequest`'s same fields** → `IPACLRuleEndpoint | MACACLRuleEndpoint`, keyed by the
    endpoint's own `type`. Along the way, fixed a latent bug in the distilled clone's flattening pass:
    `ACLRule`'s own filters were previously `unknown` with no widening warning at all — a trailing thin
    `allOf` entry (`ACL ruleObject`, structurally identical to `ACL rule`) was silently re-thinning the
    real `$ref`'d shape before the conflict-detection code ever ran, so only the create/update request
    bodies' filters showed up in the widened-field log. Fixed at the merge step (`mergeProperties`), not
    worked around here.
  - **`CreateTrafficMatchingListRequest`/`TrafficMatchingList`/`UpdateTrafficMatchingListRequest`'s
    `items`** → `Array<IPv4Matching> | Array<IPv6Matching> | Array<PortMatching>`, keyed by each item's
    own `type`.

  The runtime schema is a plain opaque `S.Unknown` (Argo CD's `union:` callback, shared by 69 distilled
  packages) — narrower for a reader at the TYPE level only; decode stays exactly as permissive as the
  `unknown` it replaces, so this carries none of the "drops an unrecognized key" risk a per-variant
  `S.Struct` would. **Not** `unionStyle: "opaque-cases"` (Cloudflare/Discord/Slack/Supabase/Typesense's
  style) — that was tried here first and reverted: its `T.UnionCases` annotation makes decode keep ONLY
  the best-matching case's keys, silently dropping a key this spec doesn't yet declare and, on a
  same-key-set tie, attributing a value's keys to the wrong case outright. A regression test proving the
  pass-through (`packages/alchemy/src/unifi/discriminated-filter-decode.test.ts`, fabricated fixtures)
  ships alongside this changeset. Bumped `minor`, not `patch`: code that previously had to cast
  `.protocolFilter`/`.macAddressFilter`/`.sourceFilter`/`.destinationFilter`/`.items` off `unknown` now
  sees a real union and may need to narrow it instead — though no kit provider reads any of these
  families yet, so nothing here currently carries the change into declared state.

  Scoped deliberately: `Network.ipv4Configuration`, `Client.access`, `WifiBroadcast.radiusConfiguration`,
  and mDNS `name` are UNCHANGED, still opaque `unknown` — `Network` already ships as `Unifi.Network`, and
  retyping its widened field would flip a permissive decode to a strict per-variant one for an
  already-adopted family, a real behavior change that needs a live snapshot and its own decision, not a
  mechanical extension of this fix.

  Also: re-verified against a fresh `beezly/unifi-apis` `10.6.97.json` mirror fetch (mirror commit
  `2457b337173c83599c583993210218b1b6c0f8e7`, diffing aid only — the regen source stays the pinned
  10.4.57 file) that the 139-schema closure reachable from all 25 FirewallPolicy/ACL rule/
  TrafficMatchingList operations — following `$ref` AND `discriminator.mapping`, not `$ref` alone — is
  byte-identical between the two spec versions (`docs/spec-version-provenance.md` in the clone).
  `docs/codegen-notes.md` and `docs/discriminator-flattening-rationale.md` updated to describe the new
  allowlist and why the four remaining fields stay widened.

  `networks.ts` is byte-unchanged (`diff -rq` against the prior release); `firewall.ts`'s `FirewallZone`
  content carries no changes, only `FirewallPolicy`'s.

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
