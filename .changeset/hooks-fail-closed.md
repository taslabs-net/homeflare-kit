---
'@homeflare/config': patch
---

The shared git hooks fail closed: a hook that cannot run now stops the commit or push and names the fix, instead of skipping and exiting 0. A gate that cannot run is fixed, never skipped.

- **The `.husky/` wrapper exits 1 when `node_modules` is missing** (it exited 0). A fresh worktree that has not run `bun install` can no longer commit or push unchecked; it prints one line, `run 'bun install' in this worktree`. The wrapper's bytes changed, so `problemsInHooks` reports every adopted repo's committed copy as drift until you regenerate and commit it: `bun node_modules/@homeflare/config/bin/hooks.ts install`.
- **`pre-commit` and `pre-push` fail without `node_modules`** instead of printing a note and returning. `pre-commit` still runs the secret scan first, which already failed closed when gitleaks is missing.
- **`pre-push` fails when a pushed ref is not the checked-out commit**, as in `git push origin other-branch` from a different branch. It used to print `NOT CHECKED` and exit 0, which let the unchecked ref through. The failure names the fix: check the ref out and push from there. An annotated tag at `HEAD` now counts as checked out, because git reports the tag object's sha and the commit is what the hook compares.
- **One such ref fails the whole push, even alongside the checked-out one.** A push of `main` and `other-branch` from `main` used to measure `main` and only note the other. It now fails and names each ref to push on its own, the checked-out one first: `push main on its own, then check out other-branch and push from there`. Two refs at the same commit, such as `HEAD:a HEAD:b`, are both checked and pass.
- **`pre-push` fails when the repo has no `check` script** (it printed "nothing to run" and exited 0). Add a `check` script to `package.json`: the lint, type and test lanes CI runs.
- **No failure message suggests a bypass.** The `bypass: git commit --no-verify` line is gone from every failure, and so is every comment arguing for it; a failure says what failed and the fix.
