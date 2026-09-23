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

| hook         | runs                                                                                  | cost       |
| ------------ | ------------------------------------------------------------------------------------- | ---------- |
| `pre-commit` | `gitleaks git --staged`, then `oxfmt` + `oxlint --deny-warnings` on staged files      | sub-second |
| `pre-push`   | the repo's own `check`, with `bun test` narrowed to the push, `build`/`smoke` skipped | seconds    |

⛔ **The secret scan is first and fails closed.** A missing `gitleaks` fails the commit
with the install line (`brew install gitleaks`). It does not skip: a scan that quietly
does nothing reads as coverage.

⚠️ **pre-commit rewrites files.** It formats the staged formattable files (`.md` too,
since house `oxfmt` formats markdown), names the ones it changed, and restages exactly
those. A file with unstaged edits on top is checked, never rewritten.

## pre-push, scoped to the push

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
needed and exits 0. It fails open, because the required checks on `main` are the gate.

`activate` does nothing under `CI`, or outside a git work tree. It never fails, because it
runs inside `bun install`.

⚠️ **While the rollout is in progress, husky can undo it.** `core.hooksPath` is one
value for the whole clone. If a worktree on a branch from before adoption runs
`bun install`, husky runs and resets it to `.husky/_`. That is the behaviour before this
change: installed worktrees keep their hooks, because husky's runner calls the same
tracked files, and never-installed worktrees have none. To restore it, run `bun install`
on an adopted branch, or `bun node_modules/@homeflare/config/bin/hooks.ts activate`.

⚠️ **Only a push of the checked-out commit can be checked.** The lanes run on the working
tree. Pushing another ref, as in `git push origin other-branch`, is reported as
**NOT CHECKED** and left to CI. It is never reported as passed.

```ts
import { problemsInHooks } from '@homeflare/config/hooks';

expect(await problemsInHooks(process.cwd())).toEqual([]);
```

⛔ `problemsInHooks` is deliberately **not** part of `checkProject`: folding it in would turn
every repo that has not adopted yet red on `main` in one commit. A repo opts in by calling it.
