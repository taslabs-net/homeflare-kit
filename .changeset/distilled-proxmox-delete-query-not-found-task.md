---
'@homeflare/distilled-proxmox': minor
---

Upstream-walk-down fixes to the PVE distilled SDK, built the distilled way in
`homeflare/proxmox` (worktree commits `ef0e4888`, `19c1b641`) and copied in unmodified — never
hand-edited here.

**WI-1 (DELETE query binding, wire behavior change).** The converter bound every DELETE
operation's non-label parameters to the request body, which PVE's server never reads for DELETE
(measured: `AnyEvent.pm` parses request content into params only for PUT/POST). Recounted by
parsing the generated Smithy operation shapes directly (not a regex over source, and not the
plan's original "40 of 51" estimate, which this pass found to be wrong): 44 of 79 PVE DELETE
request schemas carry at least one non-label parameter, and every one of those 44 carried a body
member that PVE silently discarded before this fix. DELETE now binds like
GET — query string. Every kit call site under `packages/alchemy/src/proxmox/*` that calls a
delete operation today passes labels only, so this is wire-neutral for what ships — except
`ceph-osd-write.ts`'s `deleteNodeCephOsd`, whose `cleanup` flag was already riding a DELETE body on
both `client.ts` and distilled alike (that file's own header calls this out as a pre-existing,
out-of-scope bug "worth its own fix — move `cleanup` into the query string"). This SDK change is
exactly that fix: `cleanup=1` goes from silently-ignored to an effective query parameter. No kit
consumer code changes in this PR (that stays scoped to WI-4/its own follow-up); the wire-change
audit lives in this PR's description.

**WI-3 (typed not-found errors, new exports).** Adds `UserNotFound`, `GroupNotFound`,
`StorageNotFound`, `CephPoolNotFound` (`access`/`storage`/`nodes` services) and `CephFsNotFound`
(`nodes`), each a `client`/404-tagged shape matching PVE's real HTTP-500 wire response by an
anchored, object-kind-qualified message regex — never a bare "does not exist" — following the
Forgejo `orgDelete.json` pattern. Each is attached only to the single operation actually measured
producing it. Runtime-verified non-transient via `Category.isTransientError`, and each decodes
correctly from its measured wire fixture.

**Every message traced to actual PVE Perl source, not just the kit's own prose.** An adversarial
review caught that `CephFsNotFound`'s regex and test fixture were both written from the same two
unmeasured kit comments — self-confirming, not independently measured. Fixed by cloning
`pve-access-control`, `pve-storage` and `pve-manager` read-only, at commits at or near this SDK's
own pin (`pve-manager`'s `f6997e698c7933ea`, "bump version to 9.2.11", is the exact commit the
kit's own `fetch-specs.ts` already cites as what the estate runs), and reading the actual `die`
line for each message: `UserNotFound` (`AccessControl.pm:678`), `GroupNotFound` (`Group.pm:201`),
`StorageNotFound` (`Storage.pm:259`), `CephFsNotFound` (`Ceph/FS.pm:327`) — plus confirming each
is reachable from the exact GET/DELETE handler this SDK's operation maps to (matched by the
handler's own `description` string). `CephFsNotFound`'s assumed text was wrong: the real message
is `no such cephfs '$fs_name'\n` (the filesystem name is included), not the bare `no such cephfs`
the first draft assumed — the regex and test fixture are corrected. `CephPoolNotFound`'s message
comes from Ceph/librados itself, not PVE's own Perl, so only the call site was traced; the kit's
existing live-cluster capture remains the wire-text evidence. No live DELETE was run against a
real cluster in this pass (still read-only GET probes only) — `CephFsNotFound` was corrected from
vendor source instead.

**Q3 (breaking: removed export).** Drops `src/task.ts` and the package's `./Task` export subpath
(`awaitTask`, `TaskRef`, `AwaitTaskOptions`, including the top-level re-export from `.`) — no
distilled precedent for a package-level poll helper; polling belongs in the provider (Effect
Hetzner's `actions.ts` is the upstream shape a provider-side poll should follow next). The kit's
own `packages/alchemy/src/proxmox/distilled-task-await.test.ts`, whose sole purpose was proving
this now-removed capability, is removed alongside it in this same PR (not a WI-4 consumer
migration — nothing under `packages/alchemy/src/proxmox/*.ts` that isn't a test changed).
