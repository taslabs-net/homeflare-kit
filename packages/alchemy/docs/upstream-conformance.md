# Upstream conformance, family by family

Status: open ledger. Original audit: 2026-09-22, reading `origin/main` `925454b` against
[provider-standard.md](./provider-standard.md) (`alchemy@2.0.0-beta.79`). Nothing in any
family was changed by this audit. Each row names the rule it breaks and the upstream
replacement or fix. A row is crossed off in the PR that fixes it, with that PR's evidence.
A decision marked **maintainer** is not an agent's to make. S20/S21 and decision-49
corrections below were checked on 2026-09-24; this is not a fresh audit of every row.

## Ranked findings

Findings are ranked by what they can break: runtime safety first, then contributability,
then tidiness.

1. **`cloudflare/R2BucketLock` diverges on three rules.**

   ✅ **S23 fixed 2026-09-23** (branch `claude2/distilled-r2-bucket-lock`, an agent task
   scoped to exactly this SDK swap): it now calls `@distilled.cloud/cloudflare/r2`'s
   `getBucketLock`/`putBucketLock`, the same package `MeshNode` uses, with
   `catchTag('NoSuchBucket', …)` in place of the old `instanceof NotFoundError` status
   check. The `cloudflare` peer and `client.ts` are gone from the package — nothing else
   imported either. As a side effect this also cleared the `Effect.promise` calls in
   `reconcileLock`/`deleteLock` (S19): distilled's operations are already Effects, so there
   is nothing left to promise-wrap.

   ✅ **S20 and idempotent delete fixed 2026-09-24:** [kit PR #266](https://github.com/taslabs-net/homeflare-kit/pull/266)
   removes lifecycle `Effect.orDie`, propagates distilled's typed SDK tags unchanged, and
   folds `NoSuchBucket` to success on delete. This follows beta.79's `R2/BucketSippy.ts`;
   no blanket refusal remap is needed. The existing read already folds that tag to absence.

   Still open (outside that error-handling change):
   - `reconcileLock` still skips the PUT whenever `output.rules` equals the declaration,
     without reading the live lock (S10). Neither `--force` nor `drift --repair` can
     restore lock rules removed out of band. ⚠️ Reasoned from the source, not measured live.
   - `accountId` is still a prop (S15).

   Upstream `Cloudflare.R2.Bucket` has lifecycle and CORS rules but no lock, so this is
   still a real gap. **Remaining fix:** observe before the PUT, and resolve the account
   from `CloudflareEnvironment` — the same shape change `MeshNode` uses instead of a prop.
   That makes it contributable as `lockRules` on `R2.Bucket`, or as
   `Cloudflare.R2.BucketLock`. **Decision:** maintainer, on the upstream shape.

2. **`forgejo/*` duplicates an upstream building block.**
   - ✅ **S23 fixed 2026-09-23** (branch `claude2/distilled-forgejo`, PR #180 — Tim, decision
     42, "build inside the kit first, dogfood and test"; an agent task scoped to exactly this
     SDK swap). Every call now goes through
     `@distilled.cloud/forgejo@1.0.0-rc.12`'s typed operations, `catchTag('NotFound', ...)`
     replaced the status-carrying `ForgejoError`, and `client.ts` is deleted. Verified
     operation by operation against the package before relying on it (every operation this
     family calls exists, every error it handles has a tag) — nothing was missing, so no
     distilled patch was needed. State did not move: every prop and attribute stays
     byte-identical, proven by keeping the family's existing tests unchanged plus new tests
     against a fake Forgejo exercising the real distilled protocol. No stack in this estate
     currently imports `@homeflare/alchemy/forgejo` (measured 2026-09-23 across
     homeflare-landscape and the house monorepo), so there is no live plan to re-run —
     `house/forgejo` in the house monorepo declares the same seven resource types but against
     its OWN independent hand-rolled copy under `house/forgejo/src/`, not this package; this
     PR does not touch it.
   - ⛔ **`read` still never answers `Unowned` (H1), open.** Credentials still come from
     `FORGEJO_TOKEN` at call time rather than an `alchemy/Auth` provider (S24). Both need a
     maintainer decision on the ownership-check shape before a distilled-backed
     implementation is worth writing — the client swap did not attempt either.
3. **`cloudflare/MeshNode` duplicates `Cloudflare.Tunnel.WarpConnector`.** The divergence is
   deliberate and documented in [mesh-node.md](./mesh-node.md): upstream persists the
   connector token in state as a `Redacted` attribute, and it cannot create an HA node. The
   type string `Cloudflare.MeshNode` sits inside upstream's own namespace (H14).
   **Options:** contribute `ha` upstream and raise the token-in-state concern, then switch;
   or keep the house resource as a recorded divergence. **Decision:** maintainer.
4. **Unguarded `Bun.*`, and the `node:*` modules upstream names, in shipped provider code**
   (S42). This is listed in [the Bun line](#the-bun-line). The exported `Bun.*` paths crash
   under Node, which is the runtime this package promises its consumers. The `node:*` paths
   load on Node but break the Effect-only rule.
5. **`launchd` and `linux` still have promise-based seams (H3).** `HostRunner` is a plain
   `async` interface, with `node:child_process` and `node:fs/promises` behind it, and
   failures are untyped `Error` (S19, S21). The stated reason is that a consumer implements
   plain async functions. Upstream meets the same need by letting a caller provide
   `FileSystem`, `ChildProcessSpawner` or `CommandExecutor` layers, and
   `alchemy/Util/AtomicFile.writeFileAtomic` covers the temp-and-rename write.
   ⚠️ Only in part. `local-runner.ts` creates its temp file with `O_EXCL`, mode 0600 and
   `chown` before `chmod`, and it refuses a planted symlink. `writeFileAtomic` writes with
   default flags and mode, `chmod`s afterwards, and never `chown`s.
   **Decision:** maintainer. These families are also host-specific, so "house-only" is a
   valid answer.

   ✅ **S23 fixed 2026-09-24** (branch `claude2/distilled-caddy-migrate`): `caddy/*` no
   longer has a promise-based seam at all. `Caddy.Config` now calls
   `@distilled.cloud/caddy`'s typed `admin` operations (`adaptConfig`, `loadConfig`,
   `getConfig`), `catchTag`-able via `Caddy.CaddyOpError`, with `isUnreachable`
   (caddy-http-client.ts) replacing the old `CaddyUnreachableError` class as a type guard
   over the SDK's own `HttpClientError`. The old `CaddyAdmin`/`CaddyAdminRequest`/
   `CaddyAdminResponse`/`CaddyAdminError` interfaces and `admin-calls.ts`'s hand-rolled
   `POST /adapt`/`POST /load`/`GET /config/` calls are gone. `local-admin.ts`'s measured
   unix-socket-plus-loopback transport (Host/Origin headers, ECONNREFUSED/ENOENT-only
   retry) survives as caddy-http-client.ts, now built as an Effect `HttpClient.HttpClient`
   the SDK's own protocol runs over, instead of a raw `node:http` promise interface — still
   `node:http`, not `FetchHttpClient`, because only `node:http` dials a unix socket on both
   Bun and Node (`FetchHttpClient`'s `unix` option is Bun-only). The `LoadRefused` 200-trap
   (a refused `/load` that still answers 200) is now first-class in the SDK's own
   `protocol.ts`, not re-detected in this package. A genuine SDK gap this migration found
   and patched in the distilled clone (never in this resource): `AdaptConfig`/`LoadConfig`'s
   `config` field is Caddyfile TEXT under a caller-chosen `Content-Type`, which
   `buildRequest`'s generic `HttpBody()` cascade has no seam for (no static `bodyMediaType`
   for a dynamically-typed body) — it fell to the JSON-body default, which both
   `JSON.stringify`d the Caddyfile text and overwrote the caller's `Content-Type` with
   `application/json`. Fixed in `protocol.ts`'s `encode`, shipped as
   `@homeflare/distilled-caddy@0.2.1` (a patch changeset). A second, unrelated finding: the
   SDK's own default `Caddy.Retry` policy treats ANY `HttpClientError` with a
   `TransportError` reason as retryable — including an ECONNRESET well after a `POST /load`
   was accepted — which would have re-sent an already-accepted load past the point
   admin-calls.ts's original module doc says never to. `local-admin.ts` now disables it
   (`Layer.succeed(Caddy.Retry.Retry, { while: () => false })`), leaving
   caddy-http-client.ts's own narrower retry (ECONNREFUSED/ENOENT only) as the one retry
   policy in play. State did not move: props and attributes stay byte-identical, proven by
   the family's existing tests (updated only where the typed-error message text itself
   changed) plus fake-caddy.ts, a real HTTP server, so every test already drives the real
   distilled wire protocol.
   ⛔ **Alchemy trap found along the way, house-wide, not caddy-specific:** a
   `Provider.effect(...)` layer built with `SomeLayer.pipe(Layer.provide(depsLayer))` seals
   `depsLayer`'s services away from the provider's OWN `read`/`diff`/`reconcile` handlers
   when THEY run later — `Layer.provide` satisfies the provider's construction-time
   requirement and then hides it, so a handler that itself does `yield* SomeService` (as
   `Provider.effect`'s own `ReadReq`/`DiffReq`/`ReconcileReq` type parameters invite)
   dies with "Service not found" the moment the engine calls it, not when the layer is
   built. `Layer.provideMerge` is the fix — it feeds the dependency's output into the
   provider's requirement AND keeps that output live in the result. `providers.ts`'s
   `caddyProviders()` and this family's tests were the ones actually broken by it, but any
   family whose provider handlers read a service from context has the same exposure.

   **File-size note, added in the `claude2/distilled-caddy-followup` review pass:** the
   `encode()` fix above grew `packages/distilled-caddy/src/protocol.ts` from 243 to 294
   lines, past the house's 250-line code-file cap — the original PR didn't flag this. Left
   as-is on purpose, not split: `distilled-interim.md` treats all of
   `packages/distilled-*/src/**` as copied-not-edited vendor code (⛔ "src/ is copied,
   never hand-edited in the kit"; already exempt from `.oxfmtrc.json`/`.oxlintrc.json` for
   the identical reason), which is the AGENTS.md line-cap rule's own carve-out for
   "vendored code." Its source of truth is branch `homeflare/caddy` in the distilled clone
   — a split belongs there first, then gets copied forward on the next regeneration, not
   decided unilaterally in this kit copy.

6. **`openbao/*` has no upstream equivalent, and it conforms on the contract** (Effect
   `HttpClient`, strict `Unowned`, retain). It diverges in three ways:
   - 30 `Effect.die` sites in non-test source, several of them on `diff` and
     `reconcile` paths (defect risk; S20 no longer separately bans `Effect.die`);
   - 42 test files on `node:test` (S43);
   - `Bao.*` type strings, where the vendor name is `OpenBao` (H14).

   No distilled SDK exists. OpenBao serves an OpenAPI document, so a generated SDK in
   distilled's shape is the S23 path. **Decision:** maintainer, on whether the kit authors
   a distilled package.

## Remaining family findings

The remaining sequence is split into smaller documents to keep each below 200 lines.

[Findings 7–14](./upstream-conformance-families.md) cover Proxmox, Talos, NetBox,
LiteLLM, list/JSDoc/test conventions and Discord. [Finding 15: Grafana](./upstream-conformance-grafana.md)
records the SDK migration, shipped resources and the scoped deprecated-API departure.

## Conforms

[Conforming building blocks](./upstream-conformance-conforms.md) records the measured
conformance and remaining exceptions for Paperless, GitHub, ownership, verify and
Google Workspace.

## The Bun line

[The Bun line inventory](./upstream-conformance-bun.md) preserves the runtime-boundary
measurements, portable replacements and state-format constraints.
