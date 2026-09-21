# @homeflare/alchemy

## 0.4.1

### Patch Changes

- [#62](https://github.com/taslabs-net/homeflare-kit/pull/62) [`93b7107`](https://github.com/taslabs-net/homeflare-kit/commit/93b71070b1a64701cadc1a547044a3ec4da26a50) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export TB4 control-plane Resource constructors from `@homeflare/alchemy/proxmox` (Storage, SDN, access, HA, backup, metrics, PBS). Guests and NIC apply stay Provider-only.

## 0.4.0

### Minor Changes

- [#60](https://github.com/taslabs-net/homeflare-kit/pull/60) [`df34d27`](https://github.com/taslabs-net/homeflare-kit/commit/df34d2750fca4a2b6b86490ddb0a819c12f9ea39) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `BaoAuthMethod` so a stack can enable `approle` (or jwt/oidc) instead of running `configure-engines`. Metadata only — no role ids or OIDC secrets. File audit stays out: OpenBao 2.6 file audit is config-only.

## 0.3.2

### Patch Changes

- [#58](https://github.com/taslabs-net/homeflare-kit/pull/58) [`e7c101f`](https://github.com/taslabs-net/homeflare-kit/commit/e7c101faada2b14466a1f0bbf1f93da46e5e06cb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.79. Effect stays rc.115. 79 starts Bun with production JSX (the `jsxDEV` CLI crash on 78) and declares `mime` on cloudflare-runtime; the `mime` peer stays so existing consumer installs do not drop a required line.

## 0.3.1

### Patch Changes

- [#56](https://github.com/taslabs-net/homeflare-kit/pull/56) [`5f41ad7`](https://github.com/taslabs-net/homeflare-kit/commit/5f41ad7ab59375e42bb4757dd5b4b81f4a7b6cd9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoPkiRole` and `BaoSshRole` from `@homeflare/alchemy/openbao`. The barrel already shipped both providers; stacks constructing either role had to import the resource from internals.

## 0.3.0

### Minor Changes

- [#54](https://github.com/taslabs-net/homeflare-kit/pull/54) [`d526365`](https://github.com/taslabs-net/homeflare-kit/commit/d526365a51deac968e5b0076e88b2e68b866534f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.78 and Effect to 4.0.0-rc.115. Consumers must move the override set with it — Alchemy 78's peer is `effect >= rc.115`. Effect rc.115 renamed `Config.redacted` to `Config.Redacted`. `mime@4.1.0` is now a required peer: Alchemy's cloudflare-runtime imports it and does not declare it.

## 0.2.2

### Patch Changes

- [#46](https://github.com/taslabs-net/homeflare-kit/pull/46) [`9bc37f8`](https://github.com/taslabs-net/homeflare-kit/commit/9bc37f8bd7b9af1fd5c62cc4bc48597251ef61ab) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoMount` and `BaoAuthRole` from `@homeflare/alchemy/openbao`.

  The docs already showed `import { BaoMount } from '@homeflare/alchemy/openbao'`, but the barrel only shipped the providers. Stacks constructing those resources had to import from internals.

- [#48](https://github.com/taslabs-net/homeflare-kit/pull/48) [`4967118`](https://github.com/taslabs-net/homeflare-kit/commit/4967118cc887faba34b17cd48588102736be49bb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoCloudflareRole` and the Cloudflare role catalog helpers from `@homeflare/alchemy/openbao`, and retry dropped OpenBao transports.

  Stacks declaring mint roles need the resource constructor plus `parseRolesConfig` / `expandAll` / `permissionGroupsFromEngine`. The barrel previously shipped only `BaoCloudflareRoleProvider`. A 585-role plan against a Mesh-fronted vault died mid-diff with an empty transport error; status-0 calls now retry twice.

## 0.2.1

### Patch Changes

- [#40](https://github.com/taslabs-net/homeflare-kit/pull/40) [`60c90eb`](https://github.com/taslabs-net/homeflare-kit/commit/60c90eb4682d0ded2597a79033159ab71cc7a649) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Pin `rolldown` in the consumer overrides so an unlocked install cannot float a missing tarball.

  Alchemy's optional peer `vite@^8` depends on `rolldown: ~1.2.6`. A consumer `bun add`
  (no lockfile) resolved that to 1.2.9; npm listed the version and 404'd
  `rolldown-1.2.9.tgz`. Main CI failed on that fetch after [#39](https://github.com/taslabs-net/homeflare-kit/issues/39). The override holds 1.2.8 —
  the last tarball a green smoke actually installed.

## 0.2.0

### Minor Changes

- [#36](https://github.com/taslabs-net/homeflare-kit/pull/36) [`cff4111`](https://github.com/taslabs-net/homeflare-kit/commit/cff4111c2f4461a45be5811547125b1f5d98c6d2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the HTTP and Website SDK surfaces apps were hand-rolling.

  **`@homeflare/kit/openapi`** — `createOpenApiApp()` is OpenAPIHono with one
  readable validation hook. The document and the request share a Zod schema.
  Subpath, not the main entry: a Node script that only wants `parseEnv` must not
  resolve Hono. Peers: `hono`, `@hono/zod-openapi`, `zod` (optional). Import `z`
  from `@hono/zod-openapi`.

  **`astroWebsite` / `viteWebsite`** on `@homeflare/alchemy/cloudflare` — house
  flags on Alchemy's own stacks. Astro gets `disable_nodejs_process_v2` (workerd
  process-v2 returns `[object Object]`). Vite is TanStack Start / static Vite.
  Not Nextjs: that helper hashes source and plans as create against a live Worker.

  Catalog also pins `@tanstack/react-router` 1.170.35, `@tanstack/react-start`
  1.168.52, `@tanstack/react-query` 5.102.8 — match these, do not wrap them.

## 0.1.3

### Patch Changes

- [#32](https://github.com/taslabs-net/homeflare-kit/pull/32) [`5cc2cd6`](https://github.com/taslabs-net/homeflare-kit/commit/5cc2cd62241f926aace1646fd3a1e0057e96cddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `accessIdentity` (ctx.access) and RFC 9728 MCP discovery; fix three doc defects.

  An app team reviewed the published packages before adopting and was right on every point.

  **`accessIdentity(ctx)` — Access identity without parsing a JWT.** Cloudflare attaches the
  authenticated identity to the execution context (shipped 2026-08-14), so a Worker behind
  Access reads `ctx.access.getIdentity()` with no token handling. The kit only offered
  `verifyAccessJwt`, which is the older path.

  ⛔ Both stay, because they are not alternatives: `accessIdentity` for a Worker behind
  Access, `verifyAccessJwt` for an origin that has no `ctx.access` — service-to-service, a
  non-Worker origin, or a Worker reached by service binding, since **`ctx.access` does not
  propagate through bindings**.

  ⚠️ Read groups from `accessIdentity`, not from a token: Cloudflare trims the JWT's
  `custom` claim at roughly 1 KB _silently_, so token-read group membership can be
  incomplete — an authorization bug that only appears for users in many groups.

  **`serveMcpMetadata` / `unauthorizedResponse` — RFC 9728.** The MCP spec requires a server
  to publish Protected Resource Metadata _and_ a 401 naming it in `WWW-Authenticate`.
  Publishing the document while answering a bare 401 leaves clients that follow the header
  with nowhere to go.

  **Three documentation defects, all reported and all real:**

  - `@homeflare/alchemy`'s README documented `@homeflare/alchemy/providers`, which does not
    exist. The real path is `/cloudflare`.
  - `@homeflare/cloudflare`'s npm description advertised "typed bindings" — it exports none.
  - `@homeflare/kit`'s advertised "logging" — `log` lives in `@homeflare/cloudflare`.

  **Packing no longer edits a manifest on disk.** `packForPublish` stripped `scripts` and
  `devDependencies` from the real `package.json`, packed, then restored it — which is a race
  when two smoke tests pack the same workspace dependency in parallel. It destroyed
  `@homeflare/kit`'s `scripts` block during this branch, _after_ `verify` had passed. The
  strip now happens inside the packed tarball, so nothing in the repository is written to.

## 0.1.2

### Patch Changes

- [#29](https://github.com/taslabs-net/homeflare-kit/pull/29) [`72f0787`](https://github.com/taslabs-net/homeflare-kit/commit/72f0787952b3a71bb6573476918e79117250409e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `cloudflare` is a required peer, not an optional one.

  Measured 2026-09-16 against the published 0.1.1 in a clean consumer install: importing
  `@homeflare/alchemy/cloudflare` without it throws `Cannot find package 'cloudflare'`.
  Marking it optional claimed the subpath would degrade gracefully; it does not load at all.
  An optional peer should mean a _feature_ is absent, not that an import fails.

  ⛔ **Why this got through, and what now stops it.** The README's pinned install command and
  the smoke test's install command disagreed — the smoke test installed `cloudflare`, the
  README never mentioned it, and nothing compared the two. So the gate proved an install no
  consumer would ever perform.

  `tests/peers.test.ts` now asserts the manifest, the README and the smoke script agree:
  every declared peer appears in all three, peers are pinned rather than ranged, and none is
  marked optional.

## 0.1.1

### Patch Changes

- [#27](https://github.com/taslabs-net/homeflare-kit/pull/27) [`5b73400`](https://github.com/taslabs-net/homeflare-kit/commit/5b73400e7fc2dd8e28a0368db3e5aa105ebdde9a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix the peer contract: 0.1.0 installed cleanly and threw at import.

  Measured 2026-09-16 against the published 0.1.0 in a clean consumer install — three
  defects, none of which failed at install time:

  1. **`@effect/platform-node` was a devDependency**, so a consumer got
     `Cannot find module '@effect/platform-node/NodeServices'`. Alchemy's module graph
     reaches `Cloudflare/Workers/WorkerBridge` even when you only import `/proxmox`, so it
     is a required peer, not an optional one.
  2. **The `effect` peer was ranged** `>=4.0.0-rc.112`, which resolves to rc.115 —
     `TypeError: Config.string is not a function`. Effect's rc line is not
     semver-compatible with itself, so a range is a promise this package cannot keep. Peers
     are pinned exactly now.
  3. **`@effect/platform-node-shared` still resolves up** to rc.115 against effect rc.112
     (`Cannot find module 'effect/ByteSize'`), because `platform-bun@rc.112` asks for
     `^4.0.0-rc.112`. Only a consumer-side `overrides` block holds the set together, and the
     README now says so with the exact block to paste.

  ⛔ The smoke script was `echo '…exercised by the consuming stack'` — a check that cannot
  fail, which is how all three shipped. It now packs the tarball, installs it the way the
  README says, and **imports every subpath**, because each of these threw at import rather
  than at install.

## 0.1.0

### Minor Changes

- [#25](https://github.com/taslabs-net/homeflare-kit/pull/25) [`309c644`](https://github.com/taslabs-net/homeflare-kit/commit/309c644d83c7149571f4caada135d1b8d141a484) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New package: custom Alchemy providers for five systems the vendor has none for.

  **`R2BucketLock`** — an R2 bucket's lock rules, declared rather than applied by hand. A
  lock rule is a retention floor: while a rule covers an object, no API call, no lifecycle
  rule and no credential can delete it.

  ★ Alchemy 2.0.0-beta.77 has no lock property anywhere in its R2 namespace, so the
  alternative was a runbook step a human runs once — and a plan can never show a missing
  runbook step. Covering the gap with a resource makes the drift visible in `plan`.

  ⛔ Deletion is refused by design: removing a lock removes a retention floor, which is the
  one operation this resource exists to make hard.

  ⚠️ `alchemy`, `cloudflare` and `effect` are **peers**, not dependencies — Alchemy's
  resource registry and Effect's context both break if two copies load in one process.

  **Also in this release** — the same treatment for four more systems, 140 files in all:

  - **`/proxmox`** (61 source files) — ACLs, API tokens, backup jobs, Ceph, SDN, storage.
  - **`/openbao`** (33) — mounts, policies, PKI/SSH/auth roles, Cloudflare role expansion.
  - **`/forgejo`** (12) — branch protection, org secrets, labels, webhooks.
  - **`/talos`** (8) — cluster bootstrap, machine config, health.

  ⛔ **Import a subpath, never the root.** Each system carries its own client, so a root
  barrel would pull Proxmox into a stack that only wanted Forgejo.

  ★ **The barrels are deliberately smaller than the directories** — 70 exported symbols out
  of 606 defined, chosen from what a real stack actually consumes. An `export *` would
  publish every helper as API and make the next refactor a breaking change.
