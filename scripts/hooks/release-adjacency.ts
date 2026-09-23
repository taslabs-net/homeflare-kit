/**
 * Warn (never block) when a commit edits a manifest line that sits NEXT TO `"version"`.
 *
 * 🔴 THE INCIDENT, MEASURED 2026-09-22 (PR #111, branch macmini/linux-host-seam). The PR
 *   edited `"description"` in packages/alchemy/package.json — the line directly below
 *   `"version"`. `chore: version packages` rewrites `"version"` on every release, git
 *   merges the two inside its context window and calls it a conflict, and **a conflicted
 *   PR gets no `pull_request` workflow run at all**. `ci` and `secret scan` were never
 *   reported, so there was nothing red to look at; `gh pr checks` printed three green
 *   CodeQL lines and exited 0. Three pushes and a close/reopen in 23 minutes produced
 *   zero run objects. Kit took five releases in that half hour, so the PR re-conflicted
 *   faster than it could be rebased. docs/ci-triage.md has the whole shape.
 *
 * ⛔ WHY A WARNING AND NOT A KEY REORDER. Moving `"description"` away from `"version"`
 *   is the obvious fix and it is NOT AVAILABLE HERE: oxfmt 0.68.0 imposes a canonical
 *   package.json key order and restores `name, version, description` from any position —
 *   measured 2026-09-22 by moving the key and running `oxfmt` on the file. `bun run lint`
 *   would fail and the shared pre-commit formatter would put it back. A blank-line gap
 *   dies the same way, and JSON has no comment to explain one.
 *
 * ⛔ WARNS RATHER THAN BLOCKING, for the same reason as changeset-pending.ts: the edit is
 *   often legitimate — every `description` change in this repo's history was a capability
 *   landing where the sentence genuinely had to change. A hard block on a legitimate edit
 *   trains people to pass `--no-verify`, which disables the SECRET scan too. The rule is
 *   "land it in its own pull request", and only a human can judge that.
 */
import { ok, stagedFiles } from './lib.ts';

/** The new-side line numbers a staged diff touches, from its hunk headers. */
export function changedLines(diff: string): readonly number[] {
  const lines: number[] = [];

  for (const [, startText, countText] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(startText);
    const count = countText === undefined ? 1 : Number(countText);

    // ⚠️ A pure DELETION is `+n,0` and touches no new line. It still rewrites the
    //   neighbourhood, so treat the seam — n and n+1 — as touched, or removing the line
    //   above `"version"` slips past unmentioned.
    if (count === 0) lines.push(start, start + 1);
    else for (let n = start; n < start + count; n += 1) lines.push(n);
  }

  return lines;
}

/**
 * Of `changed`, the lines that neighbour `"version"` — the conflict radius.
 *
 * ⚠️ THE RADIUS IS EXACTLY ONE LINE, measured 2026-09-22 with `git merge-file` (git
 *   2.55.0, default algorithm) on the real manifests: an edit on the adjacent line
 *   CONFLICTS with a version bump, an edit 2 lines away merges CLEAN.
 * ★ Keyed on the POSITION of `"version"`, not on the name `description`, so it stays
 *   true if oxfmt's canonical order ever puts something else there.
 */
export function adjacentEdits(manifest: string, changed: readonly number[]): readonly number[] {
  const at = manifest.split('\n').findIndex((line) => line.startsWith('  "version":')) + 1;
  if (at === 0) return [];

  // ⛔ Not `"version"` itself. Only a release writes that line, and a release is the side
  //   this rule protects a contributor FROM — flagging it would warn the release bot.
  return changed.filter((line) => line !== at && Math.abs(line - at) === 1);
}

async function git(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  return out;
}

if (import.meta.main) {
  const manifests = (await stagedFiles()).filter((f) => /^packages\/[^/]+\/package\.json$/.test(f));
  const flagged: string[] = [];

  for (const path of manifests) {
    // ⚠️ The STAGED blob, not the working tree. A file with unstaged edits on top would
    //   otherwise be read at line numbers the commit does not have.
    const staged = await git(['show', `:${path}`]);
    const hits = adjacentEdits(staged, changedLines(await git(['diff', '--cached', '-U0', path])));

    for (const line of hits) flagged.push(`${path}:${line}`);
  }

  if (flagged.length > 0) {
    console.error('\n⚠️  editing a manifest line NEXT TO "version":');
    for (const hit of flagged) console.error(`     ${hit}`);
    console.error('   Every release rewrites "version", so this conflicts — and a');
    console.error('   conflicted PR gets NO ci/secret scan run at all, with nothing red.');
    console.error('   Land it in its own PR that touches nothing else: docs/ci-triage.md\n');
  } else {
    ok('release adjacency');
  }
}
