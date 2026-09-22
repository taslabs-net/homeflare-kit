# CI triage: a required check that never appears

Not a red check — **no check**. `ci` and `secret scan` sit at "Expected" forever, the
Actions tab has nothing for the branch, and the PR cannot merge. This file says what that
means, how to confirm it in one command, and why there is no bot to tell you.

## The 30-second check

```sh
gh pr view <n> --repo <owner/repo> --json mergeable,mergeStateStatus
```

`CONFLICTING` / `DIRTY` is the answer. **Rebase; there is nothing else to do.** No amount
of pushing, closing and reopening, or re-running will produce a run.

⚠️ **Ask about ONE pull request, and ask twice.** GitHub computes mergeability lazily.
Measured 2026-09-22: `gh pr view 64` and `gh pr view 74` both answered `UNKNOWN` on the
first call and returned real values (`CONFLICTING`/`DIRTY` and `MERGEABLE`/`BLOCKED`) on
the second. A batch `gh pr list --json mergeStateStatus` answers `UNKNOWN` for most rows
because nothing has warmed them — it reads as "fine" and is a non-answer.

## Why there is nothing to look at

A `pull_request` workflow run is dispatched against the PR's **merge ref** — the result of
merging the head into the base. While the PR conflicts, GitHub cannot compute that ref, so
it creates **no run object at all**. There is no queued run, no cancelled run, no red X:
the required context is simply never reported, and a branch ruleset that requires it waits
forever. Kit's ruleset carries `bypass_actors: []` ([docs/github-hygiene.md](./github-hygiene.md)),
so nobody can force past it either.

⛔ **`DIRTY` does not mean "your checks are missing".** Runs already created are never
retracted. Measured 2026-09-22: `homeflare-landscape` PR 64 is `CONFLICTING`/`DIRTY` and
still carries `ci`, `check`, `secret scan` and `workflow lint`, all `SUCCESS` — it was
mergeable when it was pushed and `main` moved afterwards. The rule is about the FUTURE:
**every push made while the PR conflicts gets no run.** Read it as "pushes from here on
will report nothing", not "something was lost".

⛔ **Nothing else will supply the context.** Both required checks come only from
`pull_request` runs — `ci` is the aggregate job in [ci.yml](../.github/workflows/ci.yml),
`secret scan` is the gitleaks job in [security.yml](../.github/workflows/security.yml).
Neither file has a `push` trigger (see the ⛔ in `on:` for why), and security.yml's weekly
`schedule` runs against `main`, not against the PR.

## The trap: it looks GREEN, and `gh pr checks` exits 0

This is the part that costs the hour. GitHub Advanced Security default setup runs against
`refs/pull/<n>/head` as event `dynamic`, which needs no merge ref — so it fires normally
on a conflicted PR. A required context that was never dispatched is **absent** from
`statusCheckRollup` rather than pending in it, so nothing is left to be red.

Measured 2026-09-22 on kit PR 111, closed and unmergeable:

```
$ gh pr checks 111 --repo taslabs-net/homeflare-kit
Analyze (actions)                  pass   47s
Analyze (javascript-typescript)    pass   1m16s
CodeQL                             pass   3s
$ echo $?
0
```

⚠️ **An agent that polls `gh pr checks` until green and then waits for auto-merge sees
green, exit 0, and waits forever.** That is an actively wrong signal, not a missing one.
Contrast: a PR with a genuinely pending `ci` exits 8. ⛔ Exit 0 from `gh pr checks` is not
proof a PR can merge — only `mergeStateStatus` answers that.

## The measurement

Kit PR 111, branch `macmini/linux-host-seam`, 2026-09-22. Opened 20:41:41Z, closed
21:04:16Z. Three pushes and a close/reopen in 23 minutes:

```sh
$ gh api "repos/taslabs-net/homeflare-kit/actions/runs?branch=macmini%2Flinux-host-seam&per_page=50" \
    --jq '{total: .total_count, names: [.workflow_runs[].name] | unique}'
{"total": 0, "names": []}
```

Zero run objects, of any workflow, ever. `mergeStateStatus` said `DIRTY` the whole time.

★ **The A/B, same repository, same runner pool, three minutes apart.** PR 120 is PR 111's
successor with the same content. Its first head, still carrying the conflicting edit, got
nothing. Its next head `da37c6c2` — identical but for dropping that one edit — had `ci`
and `security` `pull_request` runs created at **21:03:48Z**, and the PR merged at
21:05:28Z. The only variable was whether the head conflicted.

⚠️ **What made it unwinnable, and why "just rebase" was not enough.** The only conflicting
hunk was `"description"`, one line below `"version"` in `packages/alchemy/package.json`.
Every `chore: version packages` merge rewrites `"version"`, and kit took five of those in
32 minutes — so the PR re-conflicted faster than it could be rebased. That trigger is gone
now; see below.

## Diagnostic traps

⚠️ **`?head_sha=` needs the FULL 40 characters.** An abbreviated SHA returns
`total_count: 0` — indistinguishable from the real failure, so you can "confirm" a
conflict that is not there. Prefer the branch form above, or
`gh api repos/<slug>/commits/<full-sha>/check-runs`.

⚠️ **`mergeStateStatus` is GraphQL-only.** There is no REST field for it; `gh pr view`
is the short path.

## Why there is no bot for this

Weighed 2026-09-22 and deliberately not built. Each reason is independent:

- ⛔ **The workflow files are rendered.** `ci.yml` and `security.yml` come from
  `repo-shape.ts` via `@homeflare/config/repo-shape` and are copied by every repo in the
  estate. A detector job would need `pull-requests: write` in the template that fourteen
  repositories inherit, against a `permissions: contents: read` that is otherwise uniform.
- ⛔ **A `pull_request_target` job would miss it.** A PR goes `DIRTY` because **main
  moved**, not because the PR changed, and that emits no PR-scoped event. Such a job would
  have reported PR 111 as mergeable when it opened and never fired again.
- ⚠️ **A cron sweep is slower than the window.** GitHub's minimum is 5 minutes and
  scheduled runs are routinely delayed further under load. Kit's releases land every few
  minutes; the report would arrive after the damage. ci.yml already deleted a trigger for
  recomputing an answer it had — a sweep re-asking "still clean?" is that shape.
- ★ **And it would announce the problem instead of removing it.** A flag keyed on `DIRTY`
  also fires on PRs whose checks are fine (PR 64 above), so it is noisy in exactly the
  case it is meant to be trusted.

## What was done instead

**The trigger was removed.** `"description"` moved below the `repository` block in all
eight published manifests, so `"version"`'s neighbours are now keys with a measured
zero edit rate in feature PRs (`name`, `homepage`/`license`). Measured with
`git merge-file` on the real files, git 2.55.0: a version bump against a description edit
CONFLICTS in all 8 manifests before, and merges CLEAN in all 8 after.

⚠️ **The radius is exactly one line** — an edit two lines from `"version"` already merges
clean. The fix is therefore a key order and not a blank-line gap: JSON has no comments, so
a gap cannot explain itself and the next contributor closes it.

**And pinned**, by [tests/release-adjacency.test.ts](../tests/release-adjacency.test.ts),
which runs inside `bun run check`. It reads the manifest TEXT — the invariant is textual
adjacency, which a parsed object has already thrown away — and fails if anything outside
the never-edited allowlist lands next to `"version"`. It covers
`packages/site/site.example.json`'s `deriveVersion` too, which has the identical shape and
has not cost anything yet.

⛔ **What is still exposed.** A key order fixes nothing for `packages/*/CHANGELOG.md`,
which every release prepends 30–50 lines to. A PR that edits the top of a changelog
conflicts the same way and produces the same invisible failure. Do not hand-edit a
changelog; it is generated.
