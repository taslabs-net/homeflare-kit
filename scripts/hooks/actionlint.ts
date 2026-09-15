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
 * ⚠️ SKIPS WHEN NOT INSTALLED, unlike the secret scan. The asymmetry is deliberate: a
 *   missed workflow typo costs one red CI run, while a missed secret costs a rotation.
 *   CI runs actionlint unconditionally, so nothing depends on every laptop having it.
 */
import { ok, run, stagedFiles } from './lib.ts';

const staged = await stagedFiles();
const workflows = staged.filter((f) => f.startsWith('.github/workflows/'));

if (workflows.length === 0) {
  ok('no workflow changes');
  process.exit(0);
}

const which = Bun.spawn(['which', 'actionlint'], { stdout: 'ignore', stderr: 'ignore' });

if ((await which.exited) !== 0) {
  console.error('\n⚠️  actionlint not installed — workflow changes were NOT linted here.');
  console.error('   CI will still check them. To catch it locally: brew install actionlint\n');
  process.exit(0);
}

if ((await run(['actionlint', '-color'])) !== 0) {
  console.error('\n✗ actionlint found problems in the workflows\n');
  process.exit(1);
}

ok(`actionlint: ${workflows.length} workflow file(s) clean`);
