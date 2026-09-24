# Upstream conformance, family by family

Status: open ledger. Verified 2026-09-22 by reading `origin/main` `925454b` against
[provider-standard.md](./provider-standard.md) (`alchemy@2.0.0-beta.79`). Nothing in any
family was changed by this audit. Each row names the rule it breaks and the upstream
replacement or fix. A row is crossed off in the PR that fixes it, with that PR's evidence.
A decision marked **maintainer** is not an agent's to make.

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

   Still open, and out of scope for that task (props/attributes were required to stay
   byte-identical, so neither touches the wire contract):
   - `readLock`, and now `reconcileLock`/`deleteLock` too, end in `Effect.orDie` for the
     error channel distilled leaves after `NoSuchBucket` (S20). A full fix means a typed
     refusal error for `InvalidRoute`/`CloudflareRateLimited`/`CloudflareError`, which is a
     separate, larger change than the transport swap.
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
     `reconcile` paths (S20);
   - 42 test files on `node:test` (S43);
   - `Bao.*` type strings, where the vendor name is `OpenBao` (H14).

   No distilled SDK exists. OpenBao serves an OpenAPI document, so a generated SDK in
   distilled's shape is the S23 path. **Decision:** maintainer, on whether the kit authors
   a distilled package.

7. **`proxmox/*` is the model for S38.** Its types and constraints are generated from the
   vendor schema, and a manifest records the version and sha256. It diverges in four ways:
   - the generic factory's `read` returns plain attributes, so every family except `Lxc`
     adopts silently, against the house's own H1;
   - 27 `Effect.die` sites in non-test source (S20);
   - 7 test files on `node:test`;
   - `Pbs.*` type strings (H14).
8. **`talos/*`.** Its `talosctl` calls go through `ChildProcessSpawner`, as upstream's Docker
   provider does, which conforms. Its file handling uses `Bun.file`, `Bun.write`,
   `Bun.YAML` and `node:fs` (S42), and it uses `Effect.promise` in 3 files (S19). The
   kubeconfig it writes is meant to be consumed through upstream's
   `Kubernetes.KubeConfig({ path })`.
9. **`netbox/*` conforms mostly.** Its constraints are generated from NetBox 4.7.0's
   OpenAPI. Adopting first is documented as deliberate.
   - ✅ **S23 fixed 2026-09-23** (branch `claude2/distilled-netbox-family`, mirroring the
     Forgejo migration above, decision 42). `Netbox.Prefix` now calls
     `@distilled.cloud/netbox`'s typed `ipam` operations instead of a hand-rolled `Effect
HttpClient` client. The old status-carrying `NetboxError` and its `cause.status ===
404` check are gone entirely — `Netbox.Prefix` locates by a server-side list filter,
     which never 404s (an empty page is a normal 200), so nothing here checks a status
     code at all, a stronger form of the same rule `catchTag('NotFound', …)` enforces for
     a family that reads by direct key. `client.ts` is deleted. Not published upstream
     yet, so aliased onto `@homeflare/distilled-netbox@0.2.0` as a plain `dependencies`
     entry, not a peer — [distilled-interim.md](./distilled-interim.md). State did not
     move: props/attributes stay byte-identical, proven by the family's unchanged
     existing tests plus new tests against a fake NetBox exercising the real distilled
     protocol.
   - ⛔ **Still diverges on credentials (S24):** `NETBOX_TOKEN` / `NETBOX_URL` are read at
     call time, now through the SDK's `CredentialsFromEnv` rather than a hand-rolled
     `token()` — same divergence, unchanged by the transport swap.
10. **`litellm/*` has no upstream equivalent** (LiteLLM has no upstream Alchemy family, the
    same situation `openbao/*` is in above), and conforms on the transport contract.
    - ✅ **S23 fixed 2026-09-24** (branch `claude2/litellm-distilled`, mirroring the NetBox
      migration above, decision 43). `LiteLLM.PassThroughEndpoint` now calls
      `@distilled.cloud/litellm`'s typed `misc` operations (`operations.ts`) instead of a
      hand-rolled `Effect HttpClient` client. The old status-carrying `LitellmBadRequestError`
      family is gone: every failure the four operations declare (`BadRequest`, `NotFound` on
      update, `UnprocessableEntity`, plus the shared `Unauthorized`/`TooManyRequests`/server
      errors) is the SDK's own typed error, `catchTag`'d — `deletePassThroughEndpoint`'s
      re-list-on-ambiguous-`BadRequest` trick (S21: a status-and-a-real-read decision, never
      body text) is unchanged, now keyed on the tag instead of the status code. The
      per-base-URL write semaphore this vendor's whole-list storage forces (docs/litellm.md)
      is unchanged too — the SDK has no opinion on it, so it stays one layer above the typed
      calls, in `operations.ts`. `client.ts` and the kit's own hand-generated
      `generated/pass-through.ts` are both deleted (the SDK's `misc.PassThroughGenericEndpoint`
      is the same shape, generated from the same LiteLLM 1.100.0 OpenAPI document — see
      `codegen/manifest.json`'s `litellm-openapi` entry, left in place and unconsumed rather
      than deleted, the same pattern the two UniFi entries already establish). Not published
      upstream yet, so aliased onto `@homeflare/distilled-litellm@0.2.0` as a plain
      `dependencies` entry, not a peer — [distilled-interim.md](./distilled-interim.md). State
      did not move: props/attributes stay byte-identical, proven by the family's unchanged
      existing tests (now against a fake LiteLLM exercising the real distilled protocol
      through `FetchHttpClient.Fetch`, not a loopback `Bun.serve`) plus the engine-level
      replace test through `fake-stack.ts`. No stack in this estate currently imports
      `litellmProviders`/`LiteLLM.PassThroughEndpoint` (measured 2026-09-24 across
      homeflare-landscape's own repositories, including this one's `stacks/`), so there is no
      live plan to re-run.
    - ⛔ **Still diverges on credentials (S24):** `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY`
      are read at call time, now through the SDK's `CredentialsFromEnv` rather than a
      hand-rolled `resolveCreds` — same divergence, unchanged by the transport swap.
    - ✅ **S20 fixed 2026-09-24** (same branch, PR review pass): `CredentialsFromEnv` ended in
      `Effect.orDie`, so a missing/misspelled env var died as an engine-crashing defect
      instead of the typed `ConfigError` `LitellmOpError` already declared — a regression
      this migration made newly reachable (the retired hand-rolled `credentials.ts` failed
      typed). Fixed at the source: `@distilled.cloud/litellm`'s own `credentials.ts`
      (`homeflare/litellm@4ad19154`, commit local, not pushed — S22), copied forward here.
      `netbox/*`'s `CredentialsFromEnv` has the identical `orDie` shape and is unfixed —
      out of scope for this item; tracked as its own follow-up (task `task_3bbe1684`).
11. **Every family repeats `list: () => Effect.succeed([])`**, 30 times, and only
    `R2BucketLock` and `MeshNode` declare `nuke`. The constructor already defaults `list`
    (S12). **Fix:** write the reason where it differs, and declare `nuke: { skip: true }`
    where nuke must never reach the object.
12. **Resource JSDoc is not in upstream's generator format.** Zero files use `@resource`,
    `**Example:**` or `### Section` (S31, H10). **Decision:** maintainer, because it moves
    the house's glyph rationale into `//` comments.
13. **Tests never use `alchemy/Test/Bun`.** Every lifecycle is proven against loopback
    fakes (S28, H12). Live suites need a place to run, and that is a maintainer decision.
14. **`discord/*` is new (2026-09-24, task-authorized, kit PR TBD) and built directly on
    `@distilled.cloud/discord` — no hand-rolled `client.ts` ever existed to retire.**
    `Discord.ApplicationCommand` and `Discord.GuildApplicationCommand` call the SDK's
    typed operations, `catchTag`'d through the shared `DiscordOpError` union (S21), with no
    status sniffing anywhere in `resource.ts`. It follows upstream's `Snippet.ts` reference
    exactly for a marker-less API (S7, S8): a cold `read` returns `Unowned(attrs)`, and both
    convenience constructors pipe `adopt(true)` (H5) — a stricter posture than `netbox/*`'s
    documented H1 gap, not a repeat of it. Rate-limit handling is the SDK's own default
    `Retry` policy (bounded: `Schedule.recurs(8)`, S26) — this family adds nothing on top.
    Full detail, the live Halibut census and its ownership-handover sequence, and every SDK
    gap: [`discord.md`](./discord.md). ⛔ **Diverges on S24/S25 the same way every distilled
    family in this ledger does:** credentials are read at call time through the SDK's own
    `CredentialsFromEnv`, not a house `alchemy/Auth` provider — unchanged from `netbox/*`
    and `litellm/*`'s entries above. **Gap, not yet fixed:** no vendor constraint table
    (unlike NetBox/Paperless); `options` passed through opaquely rather than modeled from
    the schema (`docs/discord.md#sdk-gaps`).

## Conforms

- **`paperless/*` (`Tag`, `DocumentType`, `StoragePath`, `CustomField`)** — ✅ **S23 fixed
  2026-09-24** (branch `claude2/distilled-paperless-family`, decision 43, mirroring the
  netbox/forgejo migrations above). Every call now goes through `@distilled.cloud/paperless-ngx`'s
  typed operations, `catchTag('NotFound', …)` replaced the status-carrying `PaperlessError`
  union, and `client.ts`/`errors.ts`/`credentials.ts` are deleted. The shared
  `matching.ts`/`matching-locate.ts` engine (locate-by-name before state, by `output.id` after —
  PR 163) is unchanged in shape. Not published upstream yet, aliased onto
  `@homeflare/distilled-paperless-ngx@0.3.0` — [distilled-interim.md](./distilled-interim.md).
  State did not move: props/attributes stay byte-identical, proven by `tag.test.ts` and the full
  PR 163 regression suite (`tag-identity.test.ts`) against a fake exercising the real distilled
  protocol. ⛔ **Still diverges on credentials (S24):** `PAPERLESS_URL`/`PAPERLESS_TOKEN` are read
  at call time, now through the SDK's `CredentialsFromEnv` — same divergence, unchanged by the
  transport swap.
- **`github/RepositoryRuleset`** (added 2026-09-23) closes the hazard the row above names:
  probes by name (`read`/`reconcile` both), answers `Unowned` on a cold name match (H1),
  normalizes before comparing so a matching live ruleset is a true noop, and refuses
  (rather than silently drops) a live rule type it does not model. Two recorded
  divergences: the type string sits in upstream's own `GitHub` namespace (H14), and the
  client is Octokit rather than distilled because distilled's `S.Struct` request schemas
  have no field for `require_extra_approval_for_unattributed_changes` (H15) — see
  [repository-ruleset.md](./repository-ruleset.md). `declareRepoPolicy` is rewired onto
  it; the row below is now describing upstream `GitHub.Ruleset` itself, which this family
  does not touch and remains usable directly.
- **`github/declareRepoPolicy`** composes upstream `GitHub.Repository` and
  `GitHub.Ruleset`. Its one hazard is upstream's own: `Ruleset.read` returns `undefined`
  without prior output, so a first deploy creates a duplicate
  ([repo-policy.md](./repo-policy.md)). The fix belongs upstream: read by name and answer
  `Unowned`. Since 2026-09-23 `declareRepoPolicy` no longer takes this path (see the
  `RepositoryRuleset` row above); this remains accurate for upstream `Ruleset` on its own.
- **`cloudflare/website.ts`** sets house defaults over upstream `Website.Astro` and
  `Website.Vite`.
- **`ownership/*`** is built only on `AdoptPolicy`, `Stack`, `State` and `Artifacts`. Its
  apply-time re-check (H2) exists because beta.79 skips the adoption probe while props hold
  an Output. That fix also belongs in the engine upstream.
- **`verify/*`** (`hf-adopt-verify`) runs Alchemy's own planner. It exists because beta.79
  labels every cold adoption as an update (H6).

## The Bun line

These are non-test files under `src/` that the standard (S42) says must be portable. "Exp"
marks files exported from a subpath `index.ts`. `git grep` on `origin/main` finds 23 non-test
files under `src/` that call `Bun.*` or import `node:*`/`bun:*`. Six of them are outside
S42's scope:

- four loopback fakes (`caddy/fake-caddy.ts`, `openbao/fake-bao.ts`, `proxmox/fake-pve.ts`,
  `proxmox/fake-pve-lxc.ts`), which are test-side under S44;
- `proxmox/provision-cli-fake.ts`, which is used only by tests;
- `verify/args.ts`, which belongs to the CLI and so is tooling under S43.

That leaves 17 files. The table lists them, plus `provision-cli-fake.ts`, which should move
out of `src/`. The six out-of-scope files still ship in the tarball's `src/`, but no export
reaches them.
⚠️ The first version of this table said 16 files and left out `launchd/job-form.ts`.
⚠️ Corrected 2026-09-22: 14 of the 17 break upstream's rule. `launchd/job-form.ts`,
`proxmox/write-only.ts` and `proxmox/pbs-notification-target-wire.ts` use only synchronous
`node:crypto` or `Buffer`. Upstream allows those inside `Effect.sync`
(`AGENTS.md@v2.0.0-beta.79#Workflow`), and 40 upstream `src/` files import `node:crypto`,
among them `Fly/Secret.ts` and `Railway/Variable.ts`. They were listed under a blanket
`node:*` ban that upstream does not have.

| file                                                       | API                                          | exp | portable replacement                         |
| ---------------------------------------------------------- | -------------------------------------------- | --- | -------------------------------------------- |
| `openbao/cloudflare-roles-config.ts`                       | `Bun.YAML`                                   | yes | parse on the tooling side; pass data in      |
| `openbao/digest.ts` (14 importers)                         | `Bun.CryptoHasher`                           | —   | `Crypto.digest` + hex; keep `canonical()` ⚠️ |
| `openbao/cloudflare-parity-snapshot.ts`                    | `Bun.file`, `Bun.Glob`                       | —   | `FileSystem` + `Path`                        |
| `openbao/approle-login-form.ts`                            | `Bun.file`                                   | —   | `FileSystem.readFileString`                  |
| `openbao/approle-login-result.ts`                          | `Bun.inspect`                                | —   | a plain formatter                            |
| `openbao/forgejo-bootstrap.ts`                             | `Bun.spawn`                                  | —   | unreferenced; `ChildProcessSpawner` or drop  |
| `talos/credentials.ts`                                     | `Bun.write/file/env/randomUUIDv7`, `node:fs` | —   | `FileSystem.makeTempFileScoped`              |
| `talos/kubeconfig.ts`                                      | `Bun.file`                                   | yes | `FileSystem`                                 |
| `talos/talos-machine-config.ts`                            | `Bun.file`                                   | yes | `FileSystem`                                 |
| `talos/values.ts`                                          | `Bun.YAML`, `node:crypto`                    | —   | tooling-side parse; hash may stay            |
| `launchd/local-runner.ts`                                  | `node:child_process`, `node:fs/promises`     | yes | H3 above                                     |
| `launchd/sudo-stage.ts`                                    | `node:fs/promises`, `node:os`, `node:path`   | —   | `FileSystem`, `Path`                         |
| `launchd/job-form.ts`                                      | `node:crypto` (`createHash`)                 | —   | allowed in `Effect.sync`                     |
| `linux/ssh-runner.ts`                                      | `node:child_process`, `node:crypto`          | yes | H3 above                                     |
| `caddy/caddy-http-client.ts`                               | `node:http`, `node:stream` (unix socket)     | yes | inherent — an Effect `HttpClient`, not H3 ⚠️ |
| `proxmox/write-only.ts`, `pbs-notification-target-wire.ts` | `node:crypto`, `node:buffer`                 | —   | allowed in `Effect.sync` ⚠️                  |
| `proxmox/provision-cli-fake.ts`                            | `Bun.spawn`, `node:fs`                       | —   | test-only; move out of `src/`                |

The ⚠️ rows:

- `openbao/digest.ts`: every `Bao.*` family persists this digest in state, so a swap must
  hash the same bytes (`canonical()`, lowercase hex), or every row plans an update.
  `Crypto.digest` from `effect/Crypto` is in every stack's services and fails with a typed
  error; `alchemy/Util/sha256` wraps WebCrypto in `Effect.promise`.
- `proxmox/write-only.ts`: a salted scrypt seal with `timingSafeEqual`. No Alchemy helper
  replaces it. A plain `sha256` would make a write-only secret cheap to brute-force from
  state, and it would change the persisted seal format.
- `caddy/caddy-http-client.ts`: unlike `launchd/local-runner.ts` and `linux/ssh-runner.ts`
  (H3, plain `async` interfaces), this is already the Effect `HttpClient.HttpClient` the
  distilled SDK's own protocol runs on — `node:http` here is the same kind of unavoidable,
  bottom-of-the-stack platform adapter `@effect/platform-node`'s own `NodeHttpClient.ts` is,
  extended with `socketPath` dialing (that module has none) because a unix socket is the
  measured transport a local Caddy needs and neither `FetchHttpClient` (Bun-only `unix`
  option) nor stock `NodeHttpClient` (URL-only) speaks one on both Bun and Node. There is no
  more-portable replacement to point to; the file already conforms to S19 (no async/await,
  no raw `Promise` — `Effect.callback`/`Effect.tryPromise` throughout).

Test runners: 51 files import `node:test`/`node:assert` (openbao 42, proxmox 7, forgejo 1,
talos 1), and 126 import `bun:test`. S43 says `bun:test`.
