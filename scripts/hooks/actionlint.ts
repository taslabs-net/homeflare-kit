/**
 * Lint the GitHub Actions workflows.
 *
 * ★ WHY actionlint AND NOT JUST tests/workflows.test.ts. Those tests assert SEMANTICS —
 *   that every action is pinned, that publishers are approved, that build precedes test.
 *   actionlint catches the other half: bad `${{ }}` expression syntax, unknown contexts,
 *   a typo'd event name, and it shellchecks every `run:` block. Neither substitutes for
 *   the other, which is why both exist.
 *
 * ⛔ THE npm PACKAGE NAMED "actionlint" IS NOT THIS TOOL. Measured 2026-09-15: npm's
 *   `actionlint` 2.0.6 is "Actionlint as wasm" with no repository field and no `bin`.
 *   The real one is rhysd/actionlint (v1.7.12), a Go binary with no npm distribution —
 *   the same shape as gitleaks.
 *     macOS:  brew install actionlint
 *     Linux:  github.com/rhysd/actionlint/releases
 *
 * ⛔ FAILS CLOSED WHEN NOT INSTALLED, like the secret scan (Tim, 2026-10-01). It used to skip
 *   with a warning on the argument that a missed workflow typo costs one red CI run while a
 *   missed secret costs a rotation. That asymmetry is gone: a gate that cannot run is fixed,
 *   never skipped, and a warning that exits 0 reads as coverage that does not exist. Only
 *   a commit that stages a workflow needs the binary, and the failure names the install.
 */
import { fail, ok, run, stagedFiles } from './lib.ts';

/** The pin is homeflare-mini's CI image: the same actionlint a laptop and CI both run. */
const INSTALL =
  'macOS: brew install actionlint — Linux: the rhysd/actionlint 1.7.12 release, ' +
  'https://github.com/rhysd/actionlint/releases/tag/v1.7.12 (same pin as homeflare-mini CI)';

const staged = await stagedFiles();
const workflows = staged.filter((f) => f.startsWith('.github/workflows/'));

if (workflows.length === 0) {
  ok('no workflow changes');
  process.exit(0);
}

if (Bun.which('actionlint') === null) {
  fail('actionlint is not installed, so the staged workflow changes were NOT linted', INSTALL);
}

if ((await run(['actionlint', '-color'])) !== 0) {
  fail('actionlint found problems in the workflows', 'fix what actionlint reported above');
}

ok(`actionlint: ${workflows.length} workflow file(s) clean`);
