/**
 * Scan the commits a push carries for secrets.
 *
 * 🔴 pre-commit's SCAN IS NOT ENOUGH. git runs no pre-commit hook for a cherry-pick, a merge, a
 *   rebase or `git am`, so a credential committed with hooks off on a side branch and
 *   cherry-picked onto `main` was never scanned. Measured by the red team on 2026-10-01: a
 *   GitHub-token-shaped string went to the remote with exit 0. The push is the one door every
 *   commit goes through, so it scans what it carries.
 * ★ THE RANGE IS "WHAT THE REMOTE DOES NOT HAVE", asked of the remote (push-remote.ts), not a
 *   base guessed from a branch name or a cache of the last fetch: `<shas> --not <its tips>`.
 * 🔴 `--diff-merges=remerge`, BECAUSE `git log -p` SHOWS NO DIFF FOR A MERGE. A token added inside
 *   a hooks-off merge commit (a conflict resolution, or `merge --no-commit` plus an edit) was
 *   pushed unscanned. Measured against real pushes: `remerge` diffs the merge against a fresh
 *   re-merge of its parents, so it catches the bad merge and passes a clean one whose parent
 *   holds an already-published finding; first-parent gives a false positive on that and
 *   dense-combined misses the bad one. It needs git 2.36, and a git without it fails the
 *   listing below — closed.
 * ⛔ THE RANGE IS LISTED BY GIT FIRST, AND A FAILURE THERE FAILS THE PUSH. gitleaks splits
 *   `--log-opts` on spaces, runs `git log`, and exits 0 with "no leaks found" when that dies
 *   (gitleaks.ts). Listing the same revisions with `git log` is the check it will not make.
 * ⛔ A DESTINATION THAT CANNOT BE ASKED, OR HAS NOTHING WE HAVE, WIDENS to every commit
 *   reachable from the pushed tips, says so, and names `.gitleaksignore` — where a reviewed
 *   false positive in old history is recorded. It is never silent, never skipped, and never
 *   narrower. The ask is only the push URL (push-remote.ts); a failure there excludes nothing.
 * ⚠️ ALL THE PUSHED REFS GO IN ONE SCAN, a deletion adds nothing to scan, and an annotated tag
 *   is peeled by `git log` itself. Output is `--redact`ed: a finding never prints the secret.
 */
import { runGitleaks } from './gitleaks.ts';
import { type PushRef, isNullSha } from './push-range.ts';
import { gitAt, knownRemoteTips } from './push-remote.ts';
import { fail, note, ok } from './report.ts';
import { INSTALL } from './secrets.ts';

/** A command line has a per-argument ceiling (128 KiB on Linux); stay well inside it. */
const MAX_OPTS = 100_000;
const MERGES = '--diff-merges=remerge';

/** As many of `tips` as fit after `used` characters. Dropping a tip only widens the scan. */
function fit(used: number, tips: readonly string[]): readonly string[] {
  const kept: string[] = [];
  let length = used;
  for (const tip of tips) {
    length += tip.length + 1;
    if (length > MAX_OPTS) break;
    kept.push(tip);
  }
  return kept;
}

export async function scanPushedSecrets(
  root: string,
  args: readonly string[],
  refs: readonly PushRef[],
): Promise<void> {
  const shas = new Set(refs.filter((ref) => !isNullSha(ref.localSha)).map((ref) => ref.localSha));
  // A manual run has no stdin: the push is `HEAD`, the same assumption push-range.ts makes.
  if (refs.length === 0) {
    const head = await gitAt(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.code === 0 && head.stdout.trim() !== '') shas.add(head.stdout.trim());
  }
  if (shas.size === 0) return;

  // ⛔ The second argument only. That is the URL being pushed to (githooks(5)). The name in
  //   args[0] is the fetch URL when pushurl differs — see knownRemoteTips.
  const asked = await knownRemoteTips(root, args[1]);
  const prefix = [MERGES, ...shas];
  const tips = fit([...prefix, '--not'].join(' ').length, asked.tips);
  const opts = tips.length > 0 ? [...prefix, '--not', ...tips] : prefix;

  const listed = await gitAt(root, ['log', '--no-show-signature', '--format=%H', ...opts]);
  if (listed.code !== 0) {
    // ⚠️ GIT MAY SAY NOTHING (a signal, a wrapper that swallows stderr): an empty reason would
    //   print "NOT scanned ()", so the exit code stands in for it.
    const said = listed.stderr.trim().split('\n')[0] ?? '';
    const reason = said === '' ? `git log exited ${String(listed.code)} and said nothing` : said;
    fail(
      'pre-push',
      `git could not list the commits being pushed, so they were NOT scanned (${reason})`,
      `fix what git reports; ${MERGES} needs git 2.36 or newer`,
    );
  }
  const count = listed.stdout.split('\n').filter((line) => /^[0-9a-f]{40,64}$/.test(line)).length;
  if (count === 0) {
    ok('pre-push: every commit in this push is already on the remote — nothing to scan');
    return;
  }

  // ⛔ NOT A SILENT SKIP — the same rule, and the same message, as secrets.ts.
  if (Bun.which('gitleaks') === null) {
    fail('pre-push', 'gitleaks is not installed, so the pushed commits were NOT scanned', INSTALL);
  }
  const widened = tips.length === 0;
  if (widened) {
    // ⛔ ONE LINE, AND IT IS THE FAILURE: a destination that could not be asked (or timed out)
    //   scans the full pushed history. It does not skip the scan and it does not exclude tips
    //   learned from anywhere else.
    const said = asked.rewritten
      ? `the destination URL is rewritten by insteadOf, so it was not asked; the full pushed history was scanned (${String(count)} commit(s))`
      : asked.via === undefined
        ? `the destination could not be asked, so the full pushed history was scanned (${String(count)} commit(s))`
        : `nothing of this push is known to be on the remote (it has none of these commits here), so all ${String(count)} reachable commit(s) are scanned`;
    note(`pre-push: ${said}; a reviewed false positive in old history goes in .gitleaksignore`);
  }
  const logOpts = opts.join(' ');
  const result = await runGitleaks(
    ['git', '--redact', '--no-banner', `--log-opts=${logOpts}`, root],
    true,
  );
  if (result.broke !== undefined) {
    fail(
      'pre-push',
      `gitleaks reported an error, so the pushed commits were NOT reliably scanned (${result.broke})`,
      `run gitleaks git --redact --no-banner "--log-opts=${logOpts}" . and fix what it reports`,
    );
  }
  if (result.code !== 0) {
    fail(
      'pre-push',
      'gitleaks found a secret in the commits being pushed',
      `remove it from those commits, then ROTATE it — assume anything committed is already compromised${widened ? ' (if it is an old finding already reviewed as a false positive, record it in .gitleaksignore)' : ''}`,
    );
  }
  ok(`pre-push: gitleaks found no secret in the commits being pushed (${String(count)})`);
}
