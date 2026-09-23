# @homeflare/typesafe

## 0.3.0

### Minor Changes

- [#158](https://github.com/taslabs-net/homeflare-kit/pull/158) [`55dc682`](https://github.com/taslabs-net/homeflare-kit/commit/55dc682f9106138a86b1d7fbc718b114ae20dc0e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `createTypeSafeGatewayClient`'s gateway transport now refuses a Jev version mismatch
  instead of silently answering with a different version, and defaults gateway logging
  off. Decision 23/24 (Tim, 2026-09-23).

  Behaviour change: pass an explicit `model` (anything other than the aliases
  `jev-latest` / `jev-preview`) and, if Cloudflare's AI Gateway answers with a different
  version, `systemOne()` now rejects with the SDK's `UnprocessableEntityError` — narrow it
  with the new `modelMismatchOf(err)` — rather than returning the wrong version's answer.
  The refusal is a synthetic response built locally (never thrown from the fetch adapter),
  so it is not retried and does not cost a second billed call; it happens only after
  Cloudflare has already run and billed the mismatched call, since this route has no way
  to check the version beforehand (measured against the catalog's own input/output JSON
  Schemas, unchanged since kit PR [#150](https://github.com/taslabs-net/homeflare-kit/issues/150)). An alias, or an omitted `model` (the SDK defaults
  it to `jev-latest`), is never refused. Every response — refusal included — now carries
  the answering model on a new `x-homeflare-gateway-model` header, alongside the existing
  `x-homeflare-gateway-key-source`.

  Also new: `collectLog?: boolean` on `TypeSafeGatewayOptions`, default `false`, sending
  `cf-aig-collect-log: false` so the gateway keeps no log entry for a call unless the
  caller opts in with `collectLog: true`. Neither this header nor any of the transport's
  other five can be added or overridden by the SDK's `defaultHeaders` or a per-call
  `headers` option — the adapter builds its outgoing header set itself and never reads
  headers the SDK computed.

  No generated types changed. `docs.typesafe.ai/models.md`'s alias list (`jev-latest`,
  `jev-preview`) is the only new vendor-schema input, cited with provenance in
  `src/gateway-model.ts`.

- [#162](https://github.com/taslabs-net/homeflare-kit/pull/162) [`b3a959d`](https://github.com/taslabs-net/homeflare-kit/commit/b3a959d421cd36f32207c61c0c92f516d609fc03) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `gate()`, a pure payload gate for `client.systemOne({state, questions})` calls (Decision 22, 2026-09-23): it validates a caller-declared field allowlist (type, length and count caps) and refuses secret-shaped content before anything is sent, returning either a frozen `{state, questions, json}` or a `no-judgment` refusal that names only a field path, a rule id and a reason — never the matched text. Every regex rule is translated from gitleaks' `config/gitleaks.toml` at tag v8.30.1 (185 of 221 regex-bearing rules emitted with provenance in `src/gate/generated/`, 36 dropped with a recorded reason — mostly constructs Node's floor here, >=22, cannot compile: a bare mid-pattern `(?i)`, a scoped modifier group, `\z`, or a POSIX class), plus a from-scratch reimplementation of detect-secrets v1.5.0's Base64/Hex high-entropy detection and IANA-derived private-address detection (`Private-Use`, `Shared Address Space`, `Unique-Local`, link-local refuse by default; loopback and documentation ranges are opt-in). Global and per-rule gitleaks allowlists are deliberately not applied, which is stricter than gitleaks itself. `internalHostnames` is a caller option with no estate default — this package stays public and bakes in no estate values.

## 0.2.0

### Minor Changes

- [#150](https://github.com/taslabs-net/homeflare-kit/pull/150) [`9ace17c`](https://github.com/taslabs-net/homeflare-kit/commit/9ace17ce2556a8f77f8721b276f668ca6e755321) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `createTypeSafeGatewayClient`: builds the official `TypeSafeClient` wired through Cloudflare's AI Gateway catalog route instead of a direct `api.typesafe.ai` key, for a consumer that holds TypeSafe's key only as BYOK behind a gateway. It returns a plain `TypeSafeClient` — `systemOne()`, retries, parsing and error classes stay the official SDK's, satisfying this package's "not a replacement client" rule — and swaps only where the bytes go, through the SDK's own `TypeSafeClientConfig.fetch` transport hook. Sends exactly `Authorization`, `cf-aig-gateway-id`, `cf-aig-no-wholesale: true`, `Content-Type` and `Accept`; drops the SDK's own `Authorization`/`X-TypeSafe-*`/`User-Agent` headers, none of which the measured route accepts. Version pinning is unavailable on this route — Cloudflare's `typesafe/jev` catalog input schema has no `model` property — so a requested model is read and silently dropped rather than forwarded or refused; the version that actually answered is always in the response body's `model` field, and which BYOK key answered is readable via `.withResponse()` on the `x-homeflare-gateway-key-source` header. `models.list()` and anything but `systemOne()` get a `NotFoundError` locally, with no network call, since the catalog route covers only that one call.

## 0.1.0

### Minor Changes

- [#53](https://github.com/taslabs-net/homeflare-kit/pull/53) [`c9ebb0f`](https://github.com/taslabs-net/homeflare-kit/commit/c9ebb0fed4b667f83b3493f485026920d379f0b4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/typesafe`: the official TypeSafe System One SDK, pinned and constructed with an explicit Worker secret. Not a replacement client.
