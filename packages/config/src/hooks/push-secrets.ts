/**
 * Scan the commits a push carries for secrets.
 *
 * 🔴 pre-commit's SCAN IS NOT ENOUGH. git runs no pre-commit hook for a cherry-pick, a merge, a
 *   rebase or `git am`, so a credential committed with hooks off on a side branch and
 *   cherry-picked onto `main` was never scanned. Measured by the red team on 2026-10-01: a
 *   GitHub-token-shaped string went to the remote with exit 0. The push is the one door every
 *   commit goes through, so it scans what it carries.
 * ★ THE RANGE IS "NOT ON ANY REMOTE REF", NOT A BASE GUESSED FROM A BRANCH NAME. `<sha> --not
 *   --remotes=<remote>` is every commit the push adds, whether it is a fast-forward, a new
 *   branch or a force-push, and it needs nothing but the remote-tracking refs git keeps.
 * ⛔ AN UNKNOWN REMOTE WIDENS, IT NEVER NARROWS TO NOTHING. With no tracking refs for the
 *   remote (a push by URL, a fresh clone with the remote renamed) nothing is excluded and the
 *   whole history is scanned — slower, never silent. The same rule as push-range.ts.
 * ⚠️ ALL THE PUSHED REFS GO IN ONE SCAN, a deletion adds nothing to scan, and an annotated tag
 *   is peeled by `git log` itself. Output is `--redact`ed: a finding never prints the secret.
 */
import { type PushRef, isNullSha } from './push-range.ts';
import { fail, ok, probe, run } from './report.ts';
import { INSTALL } from './secrets.ts';

export async function scanPushedSecrets(
  root: string,
  remote: string,
  refs: readonly PushRef[],
): Promise<void> {
  const shas = new Set(refs.filter((ref) => !isNullSha(ref.localSha)).map((ref) => ref.localSha));
  // A manual run has no stdin: the push is `HEAD`, the same assumption push-range.ts makes.
  if (refs.length === 0) {
    const head = await probe(['git', '-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD'], true);
    if (head.code === 0 && head.stdout.trim() !== '') shas.add(head.stdout.trim());
  }
  if (shas.size === 0) return;

  // ⛔ NOT A SILENT SKIP — the same rule, and the same message, as secrets.ts.
  if (Bun.which('gitleaks') === null) {
    fail('pre-push', 'gitleaks is not installed, so the pushed commits were NOT scanned', INSTALL);
  }
  const range = `${[...shas].join(' ')} --not --remotes=${remote}`;
  const code = await run(
    ['gitleaks', 'git', '--redact', '--no-banner', `--log-opts=${range}`, root],
    true,
  );
  if (code !== 0) {
    fail(
      'pre-push',
      'gitleaks found a secret in the commits being pushed',
      'remove it from those commits, then ROTATE it — assume anything committed is already compromised',
    );
  }
  ok('pre-push: gitleaks found no secret in the commits being pushed');
}
