---
'@homeflare/alchemy': patch
---

Dev-only: add `@distilled.cloud/proxmox` as a `link:` devDependency (pointing at
`bun link @distilled.cloud/proxmox` registered from the sibling `distilled` worktree, per
distilled-rules.md's KIT RULES) and a standalone test,
`src/proxmox/distilled-task-await.test.ts`, proving the new package's `awaitTask` — the
async-task 200-trap: PVE answers 200 with a UPID the moment a long-running action is queued, not
once it finishes — against a fake `HttpClient`. No existing `src/proxmox/*` resource is touched
or migrated onto the new package; this is groundwork ahead of the interim-package route (copying
the built package into a kit workspace as `@homeflare/distilled-proxmox`) the NetBox builder is
establishing, which this package will follow once that route lands. No consumer-visible change.
