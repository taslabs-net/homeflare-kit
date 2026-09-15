/**
 * Warn (never block) when package source changed with no changeset.
 *
 * ⚠️ THE FAILURE THIS CATCHES IS SILENT. Without a changeset, changesets skips the
 *   version PR entirely and publishes nothing — the PR merges green and the fix simply
 *   never reaches npm. Nothing errors; the release just does not happen.
 *
 * ⛔ WARNS RATHER THAN BLOCKING, DELIBERATELY. Plenty of legitimate commits touch a
 *   package without changing published behaviour — a test, a comment, a refactor. A hard
 *   block on those trains people to pass --no-verify, which disables the SECRET scan too.
 *   The PR template carries the real checkbox; this is the early reminder.
 */
import { ok, stagedFiles } from './lib.ts';

const staged = await stagedFiles();
const touchesPackages = staged.some((f) => f.startsWith('packages/') && f.includes('/src/'));
const hasChangeset = staged.some((f) => f.startsWith('.changeset/') && f.endsWith('.md'));

if (touchesPackages && !hasChangeset) {
  console.error('\n⚠️  package source changed with no changeset staged.');
  console.error('   If this changes what consumers install, run: bun run changeset');
  console.error('   If it does not (tests, comments, refactor), carry on.\n');
} else {
  ok('changeset check');
}
