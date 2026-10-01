# git hooks

One hook layer for the whole estate. The behaviour ships in `@homeflare/config`; a repo
commits a two-file delegating wrapper and a `prepare` line, and nothing else.

## Adopt

```sh
bun add -D @homeflare/config
bun node_modules/@homeflare/config/bin/hooks.ts install     # writes .husky/pre-commit, .husky/pre-push
npm pkg set scripts.prepare="bun node_modules/@homeflare/config/bin/hooks.ts activate"
bun install                                                  # prepare → core.hooksPath=.husky
git add .husky/pre-commit .husky/pre-push package.json
```

A repo that used husky drops it: remove `husky` from `prepare` and from
`devDependencies`. `problemsInHooks` reports a `prepare` that still runs it.

## What runs

| hook         | runs                                                                                                                           | cost       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `pre-commit` | `gitleaks git --staged`, then `oxfmt` + `oxlint --deny-warnings` on staged files                                               | sub-second |
| `pre-push`   | `gitleaks` over the pushed commits, then the repo's own `check`, with `bun test` narrowed to the push, `build`/`smoke` skipped | seconds    |

⛔ **The secret scan is first and fails closed.** A missing `gitleaks` fails the commit
with the install line (`brew install gitleaks`). It does not skip: a scan that quietly
does nothing reads as coverage.

⚠️ **pre-commit rewrites files.** It formats the staged formattable files (`.md` too,
since house `oxfmt` formats markdown), names the ones it changed, and restages exactly
those. A file with unstaged edits on top is checked, never rewritten.

⛔ **A staged file entirely excluded by oxfmt's or oxlint's own `ignorePatterns` is not a
failure.** Measured 2026-09-23: committing only a vendored, ignored file (`staged()`
classifies by extension only, not by ignore rules) made oxfmt exit non-zero with
"Expected at least one target file. All matched files may have been excluded by ignore
rules." Both tools run with `--no-error-on-unmatched-pattern` (their own documented
answer — `oxfmt --help` / `oxlint --help`, pinned versions checked directly) so "nothing
here was formattable" passes and says so: `✓ pre-commit: no formattable staged files`. A
real formatting or lint problem still fails exactly as before — the flag only changes the
all-excluded case.

⛔ **The hook resolves `.oxfmtrc.*` itself instead of trusting bare `oxfmt` to find it.**
Measured 2026-09-23 against the pinned version: bare `oxfmt` auto-discovers only
`.oxfmtrc.json` and `.oxfmtrc.jsonc`. A repo configured with `.oxfmtrc.mjs` (or `.ts`,
`.js`, `.cjs`, `.mts`, `.cts` — all valid `-c/--config` targets per `oxfmt --help`, none
auto-discovered) got formatted with oxfmt's built-in defaults instead of its own style,
silently. The hook now scans the repo root for exactly one such file and passes it with
`--config`; two or more (none of them `.json`/`.jsonc`) fails the commit loudly rather
than guess which one governs — see `src/hooks/oxfmt-config.ts`.

## pre-push, scoped to the push

⛔ **It scans what it pushes for secrets, first.** git runs no `pre-commit` for a
cherry-pick, merge, rebase or `am`, so a credential committed with hooks off on a side
branch and cherry-picked onto `main` was never scanned (measured 2026-10-01). The push is
the door every commit goes through, so `gitleaks git --log-opts="<shas> --not
--remotes=<remote>"` scans every commit the push adds: the ones on no ref of that remote.
A remote with no tracking refs (a push by URL) scans the whole history: wider, never
silent. A finding fails with "remove it, then ROTATE it", and a missing `gitleaks` fails
too. A push that only deletes refs scans nothing.

🔴 **The working tree must be what is pushed.** The lanes run on the working tree, so
`git status --porcelain` showing any change, untracked files included and ignored ones
not, fails the push with `commit or git stash -u, then push`. Before this, a committed
break with the old value restored uncommitted pushed green (measured 2026-10-01).

The base comes from git. The hook reads the pushed refs on stdin:

- **Second push to a branch**: measured from what the remote already has, so only
  the new commits are checked.
- **New branch**: measured from where it left `<remote>/HEAD`, `main` or `master`.
- **Force-push**, or a remote sha that was never fetched: also measured from where the
  branch left the default branch.
- **Deletion**, or no file changed: nothing is checked.
- **No usable base** (no remote-tracking branch, no merge base, a shallow clone): every
  lane runs and the tests run in full. The run gets wider, never empty.

The lanes are the repo's own `check`, read as an `&&` chain:

- `bun test …` becomes `bun test … --changed=<base>`. Bun follows the import graph
  and runs only the test files the changed files can reach.
- `build*` and `smoke*` scripts are skipped. CI runs them on every pull request.
- A script that hides a `bun test` or a build is expanded. For example
  `check → verify → bun test` becomes a narrowed test lane. Any other script runs
  under its own name, exactly as written.
- A test script that is not a plain `bun test`, such as vitest with coverage thresholds
  or `node --test`, runs in full and is labelled `(IN FULL)`.
- A push that changes a `package.json`, `bun.lock`, `bunfig.toml` or `tsconfig*.json`
  runs the tests in full. Imports cannot see those files, but every test runs on them.
- ⛔ A `check` whose every lane is skipped, such as only `build`, **fails** the push. It
  used to print "0 lane(s) passed" and exit 0.

⛔ **It never calls `verify` by name.** In `homeflare-proxmox`, `verify` is a live
adoption verifier. The hook follows `verify` only when `check` itself delegates to it,
because then `verify` is what CI runs.

⚠️ **The hook no longer certifies that CI will pass.** It certifies that `check`'s lint
and type lanes pass and that every test the push can reach passes. The build, the smoke
test and the tests the push cannot reach are left to CI, and the success line says so.

## Every worktree

`activate` sets `core.hooksPath=.husky`. The path is relative and lives in the clone's
shared config, so each worktree runs its own checked-out `.husky/`, including a fresh
`git worktree add` that has never been installed.

husky's `.husky/_` only existed where husky had run, so every other worktree of the clone
had no hooks at all. In an uninstalled worktree, the wrapper prints that `bun install` is
needed and exits 1. ⛔ **It fails closed** (Tim, 2026-10-01): a gate that cannot run is
fixed, never skipped, and no hook message offers a way round it. `pre-commit` and
`pre-push` fail the same way when `node_modules` is missing, after the secret scan has run.
The wrapper also fails, naming the install, when `bun` is not on `PATH`. Without that
check the shell's own `exec: bun: not found` was the whole message.

🔴 **A repo that adopted earlier keeps its old wrapper, and the runner stops it.** The
version bumper refreshes the dependency and never `.husky/*`, so a consumer's committed
copy keeps the old bytes (one that exited 0 with no `node_modules`) until someone runs
`install`. On every `pre-commit` and `pre-push` the runner compares `.husky/<hook>` with
the current wrapper and fails with `bun node_modules/@homeflare/config/bin/hooks.ts
install`, then commit the two files. `problemsInHooks` reports the same drift.
Only a file that starts with `# HomeFlare shared git hook` is compared. A hook file a repo
wrote for itself, such as this repository's own `.husky/`, which runs kit-only scripts
after the shared runner, is not, and `install` would overwrite it.

⚠️ **A package in a subdirectory is not supported.** The wrapper and the `node_modules`
check look for `node_modules` at the repository root, because git runs a hook there. A
layout whose package lives in a subdirectory with its own `node_modules` would fail with
"run `bun install`" and no way for that to fix it. No estate repo has that layout, so it
is stated and not handled.

`activate` does nothing under `CI`, or outside a git work tree. It never fails, because it
runs inside `bun install`.

⚠️ **While the rollout is in progress, husky can undo it.** `core.hooksPath` is one
value for the whole clone. If a worktree on a branch from before adoption runs
`bun install`, husky runs and resets it to `.husky/_`. That is the behaviour before this
change: installed worktrees keep their hooks, because husky's runner calls the same
tracked files, and never-installed worktrees have none. To restore it, run `bun install`
on an adopted branch, or `bun node_modules/@homeflare/config/bin/hooks.ts activate`.

⚠️ **Only a push of the checked-out commit can be checked.** The lanes run on the working
tree. Pushing another ref, as in `git push origin other-branch`, **fails** with the fix:
check that ref out and push from there. It is never reported as passed, and no longer
exits 0 with a note. An annotated tag at `HEAD` counts as checked out: its commit is
compared, not the tag object.

⛔ **One ref that is not the checkout fails the whole push, even alongside one that is.**
`git push origin main other-branch` from `main` used to measure `main` and note
`other-branch` as unchecked, which let it through. Now it fails and names the order:
`push main on its own, then check out other-branch and push from there`. Two refs that
are both the checkout, such as `HEAD:a HEAD:b`, are both checked and pass. A deletion is
not a ref to check.

⛔ **A repo with no `check` script fails the push.** It used to print "nothing to run" and
exit 0, which read as a pass on a repo with no checks at all. The failure says to add one.

```ts
import { problemsInHooks } from '@homeflare/config/hooks';

expect(await problemsInHooks(process.cwd())).toEqual([]);
```

⛔ `problemsInHooks` is deliberately **not** part of `checkProject`: folding it in would turn
every repo that has not adopted yet red on `main` in one commit. A repo opts in by calling it.
