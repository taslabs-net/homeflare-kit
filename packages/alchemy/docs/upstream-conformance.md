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

2. **`forgejo/*` duplicates an upstream building block.** `client.ts` is a hand-rolled
   Effect `HttpClient` client with a status-carrying `ForgejoError`, while
   `@distilled.cloud/forgejo@1.0.0-rc.12` exists. That package's Smithy service version is
   16.0.3, the version this family measured (S21, S23). Credentials come from
   `FORGEJO_TOKEN` at call time instead of an Auth provider (S24). `read` never answers
   `Unowned` (H1). **Replacement:** the distilled SDK plus an `alchemy/Auth` provider.
   Untyped errors become distilled patches. **Decision:** maintainer, because it changes
   the error surface.
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
5. **`launchd`, `linux` and `caddy` have promise-based seams (H3).** `HostRunner` and
   `CaddyAdmin` are plain `async` interfaces, with `node:child_process`, `node:fs/promises`
   and `node:http` behind them, and failures are untyped `Error` (S19, S21). The stated
   reason is that a consumer implements plain async functions. Upstream meets the same need
   by letting a caller provide `FileSystem`, `ChildProcessSpawner` or `CommandExecutor`
   layers, and `alchemy/Util/AtomicFile.writeFileAtomic` covers the temp-and-rename write.
   ⚠️ Only in part. `local-runner.ts` creates its temp file with `O_EXCL`, mode 0600 and
   `chown` before `chmod`, and it refuses a planted symlink. `writeFileAtomic` writes with
   default flags and mode, `chmod`s afterwards, and never `chown`s.
   **Decision:** maintainer. These families are also host-specific, so "house-only" is a
   valid answer.
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
   OpenAPI, and it uses Effect `HttpClient`. Adopting first is documented as deliberate.
   It diverges in its credentials: `NETBOX_TOKEN` is read at call time (S24).
10. **Every family repeats `list: () => Effect.succeed([])`**, 30 times, and only
    `R2BucketLock` and `MeshNode` declare `nuke`. The constructor already defaults `list`
    (S12). **Fix:** write the reason where it differs, and declare `nuke: { skip: true }`
    where nuke must never reach the object.
11. **Resource JSDoc is not in upstream's generator format.** Zero files use `@resource`,
    `**Example:**` or `### Section` (S31, H10). **Decision:** maintainer, because it moves
    the house's glyph rationale into `//` comments.
12. **Tests never use `alchemy/Test/Bun`.** Every lifecycle is proven against loopback
    fakes (S28, H12). Live suites need a place to run, and that is a maintainer decision.

## Conforms

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
| `caddy/local-admin.ts`                                     | `node:http` (unix socket)                    | yes | H3 above                                     |
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

Test runners: 51 files import `node:test`/`node:assert` (openbao 42, proxmox 7, forgejo 1,
talos 1), and 126 import `bun:test`. S43 says `bun:test`.
