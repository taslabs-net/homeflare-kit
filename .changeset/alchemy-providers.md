---
'@homeflare/alchemy': minor
---

New package: custom Alchemy providers for five systems the vendor has none for.

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
