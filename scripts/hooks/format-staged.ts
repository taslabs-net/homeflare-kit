/**
 * Format and lint the STAGED files, then restage what changed.
 *
 * ★ WHY NOT lint-staged. It is the standard answer and a fine tool, but it exists to
 *   solve a problem oxfmt does not have: running many linters over globbed subsets with
 *   partial-stash semantics. oxfmt takes a file list and is measured in milliseconds, so
 *   this is ~30 lines and one fewer dependency.
 *
 * ⚠️ RESTAGES AFTER FORMATTING. Without that, oxfmt rewrites the working tree and the
 *   commit captures the UNFORMATTED version — CI then fails on a file that looks correct
 *   locally, which is a genuinely confusing hour.
 * ⛔ Only files already staged are restaged. Never `git add -A` in a hook: a contributor
 *   with unrelated work in progress would find it committed for them.
 */
import { fail, ok, run, stagedFiles } from './lib.ts';

const files = (await stagedFiles()).filter((f) => /\.(ts|tsx|js|jsx|json|jsonc)$/.test(f));

if (files.length === 0) {
  ok('no formattable files staged');
  process.exit(0);
}

if ((await run(['bunx', 'oxfmt', ...files])) !== 0) {
  fail('oxfmt failed', 'bun run lint:fix');
}

if ((await run(['bunx', 'oxlint', ...files])) !== 0) {
  fail('oxlint found problems', 'bun run lint:fix, then fix what remains by hand');
}

if ((await run(['git', 'add', '--', ...files])) !== 0) {
  fail('could not restage formatted files');
}

ok(`formatted and linted ${files.length} staged files`);
