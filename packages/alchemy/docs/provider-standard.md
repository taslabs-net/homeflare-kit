# The provider standard

Status: in force. Verified 2026-09-24 against `alchemy@2.0.0-beta.79` (tag
`v2.0.0-beta.79`, commit `473c3959`) and the distilled commit that tag pins (`c2a78002`).
Decision 49 ("upstream wins", 2026-09-24): where upstream has a rule or clear convention, the
house follows it exactly, neither looser nor stricter; a house rule only fills a gap upstream
is silent on. This update corrects S20 and clarifies S21 against the pinned source; it
does not claim a new audit of every rule or family.

This page is the kit-side statement of the house standard for a custom Alchemy provider.
The full rule set is the `alchemy-provider-standard` skill in the estate's workflow plugin.
It has 46 numbered rules (S1–S46) and 14 house differences (H1–H14), and every rule cites
`alchemy-run/alchemy` as `<path>@v2.0.0-beta.79#<section>`. This page keeps the rule numbers
so that a review comment can name the rule a change breaks. How each family measures up is
in [upstream-conformance.md](./upstream-conformance.md).

★ **Why this package holds itself to upstream's bar.** Everything in `@homeflare/alchemy`
should be good enough to contribute to Alchemy. So the kit builds only what upstream lacks,
and builds it the way upstream would. A house re-implementation of something Alchemy
already ships is a finding, even when it works.

## Three questions before any code

1. **Does upstream ship the resource?** Look under `packages/alchemy/src/<Cloud>/` at the
   pinned tag. If it does, use it. `github/` does exactly this: it composes
   `GitHub.Repository` and `GitHub.Ruleset`. `website.ts` does it too, over
   `Website.Astro` and `Website.Vite`. A missing prop means an upstream PR, never a fork
   (S1).
2. **Does `@distilled.cloud/<vendor>` exist?** If it does, every call goes through it,
   with its typed error unions and Credentials layer. A second SDK or a hand-rolled client
   is a finding. On 2026-09-22 npm had distilled packages for Forgejo, GitHub, Kubernetes
   and Docker, among others, and none for Proxmox, OpenBao, Caddy, Talos, NetBox or UniFi
   (S23). A missing package is not a licence to invent one — see
   [talos-argocd-dogfood.md](./talos-argocd-dogfood.md).
3. **Does Alchemy ship the helper?** Hashing (`alchemy/Util/sha256`), polling
   (`alchemy/Util/poll`), atomic writes (`alchemy/Util/AtomicFile`), equality
   (`deepEqual` in `alchemy/Diff`), names (`alchemy/PhysicalName`), tags (`alchemy/Tags`),
   ownership (`alchemy/AdoptPolicy`), credentials (`alchemy/Auth`) and the test harness
   (`alchemy/Test/Bun`) all exist. Use them.

## The contract, in brief

- **Shape (S2, S3).** Declare the interface as
  `Resource<"Vendor.Service.Type", Props, Attrs, never, Providers>`, and the constructor as
  `const X = Resource<X>(…)`. The type string starts with the vendor's own name. The
  contract and its provider share a file, and helpers go in sibling files that `index.ts`
  does not export.
- **Props (S5).** Props are plain types, never `Input<T>`, and every field has JSDoc.
- **Diff (S6).** `diff` narrows with `isResolved`. It returns `undefined` for an ordinary
  update and `replace` only for identity changes.
- **Read (S7, S8).** `read` works with `output: undefined`. It answers `undefined`, plain
  attributes or `Unowned(attrs)`. This package answers `Unowned` for any live object this
  stack cannot prove it made (H1; [ownership.md](./ownership.md)).
- **Reconcile (S9, S10).** `reconcile` is one flow: observe, ensure, sync, return. It
  never trusts `output` as proof, and it makes zero writes when nothing drifted.
- **Delete (S11, S14).** `delete` is idempotent and bounded. A family whose deletion
  breaks its consumers defaults to `retain`, and still implements `delete` in full.
- **List (S12).** `list` enumerates every object of the type in its scope, or returns `[]`
  with the reason written down. A family whose objects carry ownership marks filters to
  owned ones, as upstream's third-party providers do; the core contract does not ask for it. `nuke` is declared wherever nuke must never reach the object.
- **Scope (S15).** The account, zone and region are resolved inside each operation. They
  are never props.

## Code, errors, credentials

- **Effect only (S19).** Provider code, helpers and tests use `FileSystem`, `Path`,
  `HttpClient` and `ChildProcessSpawner`. They never use `async`/`await`, a raw `Promise`,
  `node:fs`, `node:fs/promises`, `node:os`, `node:path` or bare `fetch`. A synchronous,
  CPU-only Node call (`node:crypto` `createHash`, `Buffer`) goes inside `Effect.sync`, which
  is upstream's own example. When a promise cannot be avoided, use `Effect.tryPromise`,
  never `Effect.promise`.
- **Lifecycle errors (S20).** Upstream's rule is: "Do not use `Effect.orDie` in the
  lifecycle operations since this will crash the whole IaC engine."
  Cite: `AGENTS.md@v2.0.0-beta.79#L630`. It names `Effect.orDie` in lifecycle operations;
  S20 adds no separate ban on `Effect.die` or on code outside those operations.
  `Effect.die` still creates a defect. The engine's narrow recovery exception is the
  best-effort read for an interrupted create: `Effect.catchDefect` degrades a crashed
  recovery read to nothing recovered (`packages/alchemy/src/Plan.ts@tag#L1447`,
  `packages/alchemy/src/Apply.ts@tag#L2218`). Ordinary lifecycle calls have no such
  recovery wrapper (`Plan.ts@tag#L1303-L1315`); this is not a general safe-defect path.
  Expected refusals stay typed errors.
- **Typed errors (S21, S22).** Handle errors with `Effect.catchTag` over the SDK's union;
  other typed SDK errors can propagate unchanged, as upstream's R2 `BucketSippy` does.
  The resource-specific-tag patch rule applies to errors **outside** that typed union
  (`AGENTS.md@tag#L733-L738`). Where a package's protocol includes status classes in
  its union (argocd, hetzner, fly-io and neon at distilled `c2a78002`), catch those tags
  directly: upstream `Hetzner/Certificate.ts@tag#L251,L288-L291` catches `NotFound`
  for absent reads and successful deletes. No replacement tag is needed for an already
  typed `NotFound`. Where the kit generates its own client from a vendor schema, the
  status-to-tag mapping lives in that client, once, and never in a resource.
- **Credentials (S24).** Credentials come from an `alchemy/Auth` provider and a lazy
  Credentials service. Short-lived credentials are minted per call, never reused, and never
  taken as props.
- **Secrets (S25).** A secret value is never a prop or an attribute. Alchemy persists
  `Redacted` values in plaintext, and only one state store encrypts them.
- **Bounded waits (S26).** A retry stops after at most 8 to 10 attempts and under about a
  minute. A poll never runs past about 90 seconds.

## The Bun line for this package (S42–S45)

★ This package is Bun to author and runtime-neutral to consume. It builds with
`bun build --target node`, and consumers run `dist/` on Node.

- **`src/**` provider code** (resources, providers, clients, and helpers a provider calls)
  never calls `Bun.*` and never imports `bun:*` or the `node:*` modules S19 names. A Node
  consumer calling an exported helper that uses `Bun.YAML` fails with
  `ReferenceError: Bun is not defined` at the call site. `node:crypto`, `node:http` and
  `node:child_process` all load on Node. Where they break the standard, they break the
  Effect-only rule, not the runtime.
- **Tests, fakes, scripts and codegen** are Bun-native. That means `bun:test` (never
  `node:test`, never vitest), `Bun.serve` fakes on loopback, `Bun.YAML`, `Bun.file()`,
  `Bun.Glob` and `Bun.CryptoHasher`. Upstream runs its scripts and its test runner on Bun
  too.
- **A module that truly needs Bun** is named for Bun, sits behind its own subpath, or
  guards on `typeof globalThis.Bun`. The package root never reaches it.

The files currently on the wrong side of the line are listed in
[upstream-conformance.md](./upstream-conformance.md#the-bun-line).

## Versions (S37–S41)

- **One aligned set.** `effect`, `@distilled.cloud/*` and `@effect/platform-*` are pinned
  exactly to what the pinned `alchemy` release was built and tested against. They move only
  in the same PR as the `alchemy` bump.
- **Every family records the vendor version it was walked against, in code.**
  - For a generated client, the record is the schema manifest entry and the generated
    header. `codegen/manifest.json` holds the product, version, sha256, fetch date and
    source role for PVE, PBS, UniFi and NetBox.
  - For a distilled-backed family, it is the chain: `alchemy` version, distilled package
    version, distilled commit, spec-mirror commit and date, and Smithy service version.
  - For a CLI or OS-service family, it is the binary or OS version, the command that
    reports it, and the date, in that family's docs page.
- **And in its changeset.** A provider change names the vendor version it was walked
  against. A pin move names every link, old and new.

| family              | vendor version walked against          | recorded in                       |
| ------------------- | -------------------------------------- | --------------------------------- |
| `proxmox` (PVE)     | pve-manager 9.2.11                     | `codegen/manifest.json` + headers |
| `proxmox` (PBS)     | proxmox-backup-server 4.2.6-1          | `codegen/manifest.json` + headers |
| `netbox`            | NetBox 4.7.0 OpenAPI                   | `codegen/manifest.json` + headers |
| `cloudflare`        | distilled 1.0.0-rc.12 (API v4)         | `package.json` pins only          |
| `openbao`           | OpenBao 2.6.2                          | source comments only ⚠️           |
| `caddy`             | Caddy 2.11.4                           | source comments only ⚠️           |
| `forgejo`           | Forgejo 16.0.3                         | source comments only ⚠️           |
| `talos`             | Talos v1.13 docs (never measured live) | source comments only ⚠️           |
| `launchd` / `linux` | macOS 27 / systemd 257 / Podman 5.4.2  | source comments only ⚠️           |

⚠️ These rows record a version only in prose, so no test catches a drift. `schemas/manifest.json`
also repeats the PVE, PBS and UniFi entries, which means there are two manifests for one
fact.

## Where this package differs from upstream on purpose

Each difference is written down with its reason. H1 is strict `Unowned`. H2 is the
apply-time ownership re-check in `ownership/`. H4 is `retain` by default. H5 is `adopt(true)`
on each resource. H6 is `hf-adopt-verify`. [upstream-conformance.md](./upstream-conformance.md)
marks each one justified or a gap. Anything not listed there is a gap by definition.
