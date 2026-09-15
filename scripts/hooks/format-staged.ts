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

// ⚠️ MARKDOWN IS IN THIS LIST, and leaving it out is why a push once failed after a
//   clean commit: `oxfmt --check .` formats .md too, so a hook that skipped it let an
//   unformatted changeset through and the pre-push verify caught it instead. A hook must
//   check exactly what CI checks, or it trains people to distrust it.
const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md)$/;

const files = (await stagedFiles()).filter((f) => FORMATTABLE.test(f));

if (files.length === 0) {
  ok('no formattable files staged');
  process.exit(0);
}

if ((await run(['bunx', 'oxfmt', ...files])) !== 0) {
  fail('oxfmt failed', 'bun run lint:fix');
}

const code = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

if (code.length > 0 && (await run(['bunx', 'oxlint', ...code])) !== 0) {
  fail('oxlint found problems', 'bun run lint:fix, then fix what remains by hand');
}

if ((await run(['git', 'add', '--', ...files])) !== 0) {
  fail('could not restage formatted files');
}

ok(`formatted and linted ${files.length} staged files`);
