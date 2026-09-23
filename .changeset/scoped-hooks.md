---
'@homeflare/config': minor
---

The shared git hooks are active in every worktree, and pre-push is scoped to the push.

- **pre-commit scans for secrets first** (`gitleaks git --staged`), then formats and
  lints the staged files as before. A missing `gitleaks` fails the commit with the
  install line instead of skipping.
- **pre-push runs the repo's own `check`, narrowed**: lint and types run as `check`
  spells them, and each `bun test` becomes `bun test --changed=<base>`, so only the test
  files the pushed changes can reach run. `build*` and `smoke*` scripts are left to CI.
  The base comes from git's stdin: a second push is measured from what the remote has,
  and a new branch from where it left the default branch. A push that changes a manifest,
  lockfile, `bunfig.toml` or `tsconfig` runs the tests in full, and so does a push with no
  usable base. The run gets wider, never empty.
- **New `activate` command, for `prepare`**:
  `"prepare": "bun node_modules/@homeflare/config/bin/hooks.ts activate"` sets
  `core.hooksPath=.husky`. That path is relative and tracked, so every worktree of the
  clone runs its own hooks, including a fresh `git worktree add`. husky's `.husky/_`
  existed only where husky had run. `activate` does nothing under `CI`.
- **Adoption changes**: husky is no longer needed, and `problemsInHooks` now reports a
  `prepare` that does not activate, a `prepare` that still runs husky, and a wrapper
  that is not executable. The wrapper passes git's arguments through (`"$@"`), so
  re-run `install` to rewrite `.husky/pre-commit` and `.husky/pre-push`.
- New exports: `activateHooks`, `planLanes`, `PREPARE`, and the `Lane` type.
