# @homeflare/alchemy

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
