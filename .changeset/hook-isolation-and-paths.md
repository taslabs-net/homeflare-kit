---
'@homeflare/config': patch
---

Two defects in the hook layer, both measured the expensive way.

🔴 **`pre-push` now strips the inherited `GIT_*` before running `bun run check`.** Git
exports `GIT_DIR` and `GIT_INDEX_FILE` to a hook and everything it spawns inherits them;
`check` runs the test suite, and a test that builds a throwaway git repository and
commits in it commits into the repository being pushed instead — `cwd` is ignored once
`GIT_DIR` is set. Measured 2026-09-22 at the cost of two junk files (`partial.ts`,
`ugly.ts`, removed here) and a stray `Probe <probe@example.invalid>` commit reaching this
repository's `main` through PR #121. ⛔ The fix belongs in the hook, not in fourteen test
suites: every repo in the estate is about to run its tests from `pre-push`, and
`packages/site/tests/checkout.test.ts` already carried a comment warning about exactly
this trap — which is how much a convention is worth.

🔴 **Staged paths are read with `-z`.** Without it git applies `core.quotePath` and a
file named `café .ts` comes back as the literal `"caf\303\251 .ts"` — quotes,
backslashes, octal escapes. oxfmt is then handed a path that does not exist, every commit
touching that file fails with a message about the wrong name, and the obvious response is
`--no-verify`. Regression-tested with a non-ASCII, space-bearing filename.

`packages/config/tests/hooks-gates.test.ts` is hardened the same way it should have been
written: the scratch repository is a top-level `const` rather than a `let` a hook fills,
every `git` call names it with `-C` and runs with `GIT_*` dropped, and the identity is
passed with `-c` instead of a `git config` write that landed in the real repository.

`scripts/hooks/verify.ts` — this repository's own pre-push, which runs the wider `verify`
rather than `check` — gets the same treatment, because it is the one hook in the estate
that does not go through the shared runner.
