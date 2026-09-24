---
'@homeflare/distilled-proxmox-backup': minor
---

Upstream-walk-down fixes to the PBS distilled SDK, built the distilled way in
`homeflare/proxmox-backup` (worktree commit `6fc1d295`) and copied in unmodified — never
hand-edited here.

**WI-1 (DELETE query binding, wire behavior change).** Same bug and fix as
`@homeflare/distilled-proxmox`'s own release note (this converter is a direct port): the
converter bound every DELETE operation's non-label parameters to the request body — core's own
convention is query, not body, for DELETE (Kubernetes' generated DELETE operations are the
upstream precedent). Recounted by parsing the generated Smithy operation shapes directly (not
the plan's original "19 of 20" estimate, which this pass found to be wrong): 24 of 38 PBS DELETE
request schemas carry at least one non-label parameter, and every one of those 24 carried a body
member. No kit code
currently imports `@distilled.cloud/proxmox-backup` (measured — it is aliased in
`packages/alchemy/package.json` but unused), so this is wire-neutral for what ships today.

**WI-2 (spec provenance — no functional change, declared honestly).** This package consumed
`specs/.local` with no `SPEC_REPOS` entry, so `specs:check` failed and nobody else could
regenerate it — the committed output existed only via a gitignored local copy. Proxmox publishes
no `pbs-docs` mirror the way it does `pve-docs` (`https://api.github.com/repos/proxmox/pbs-docs`
answers 404), and the estate has no PBS host yet to pull the real spec from over SSH. Declared
`blocked` in `SPEC_REPOS` (the Slack precedent) rather than given a non-functional fetch-script
scaffold. `specs:check` now passes. Regenerating from `specs/.local` reproduces `src/services/*`
byte-for-byte across two independent runs (verified via sha256).
