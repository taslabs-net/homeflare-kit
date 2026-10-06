/**
 * Run the lanes `planLanes` produced.
 *
 * ⛔ THE TEST LANE GETS ITS OWN TMPDIR. Leftovers fail the push, listed by name prefix
 *   with a count, and cleanup is attempted either way. Lint and types do not get one:
 *   they are not where the temp-directory leak comes from.
 * 🔴 `runLane` / `runInTmp` strip the GIT_* this hook inherited — see report.ts.
 * ⛔ THE LOG IS THE LABEL AND A COUNT. `command` lists every selected path, and a
 *   path with a newline would forge a second log line. Names stay in the command
 *   that runs; the line that is printed does not include them.
 */
import { type Lane } from './push-plan.ts';
import { fail, note, ok, runLane } from './report.ts';
import { formatLeaks, problemsInTmpLiterals, runInTmp } from './tmp-guard.ts';

function selected(lane: Lane): number {
  return lane.kind === 'test' ? (lane.selected ?? 0) : 0;
}

/** The one-line reason a lane is in the run, printed before it starts. */
function describe(lane: Lane): string {
  if (lane.kind === 'skip') return `skip ${lane.label} — ${lane.why}`;
  const n = selected(lane);
  if (lane.kind === 'test' && lane.scoped) {
    const which =
      n === 0
        ? 'only the tests the push can reach'
        : `${String(n)} selected, only the tests the push can reach`;
    return `run  ${lane.label}  (${which})`;
  }
  if (lane.kind === 'test') return `run  ${lane.label}  (IN FULL)`;
  return `run  ${lane.label}`;
}

/** What to re-run. The label and, when files were appended, how many — not their names. */
function untilGreen(lane: Lane): string {
  const n = selected(lane);
  const count = n === 0 ? '' : ` (${String(n)} selected)`;
  return `${lane.label}${count} — until it is green`;
}

/** How many lanes actually ran. Calls `fail`, which does not return, when one does not pass. */
export async function runPlannedLanes(
  root: string,
  lanes: readonly Lane[],
  changed?: readonly string[],
): Promise<void> {
  const literals = await problemsInTmpLiterals(root, changed);
  if (literals.length > 0) {
    fail(
      'pre-push',
      `${String(literals.length)} test path literal(s) hardcode a host temp directory\n  ${literals.join('\n  ')}`,
      'use os.tmpdir(), or add a `tmp-allow: <reason>` comment on that line',
    );
  }

  const started = Bun.nanoseconds();
  let ran = 0;
  for (const lane of lanes) {
    note(describe(lane));
    if (lane.kind === 'skip') continue;
    if (lane.kind === 'test') {
      const guarded = await runInTmp(lane.command, root);
      if (guarded.code !== 0 || guarded.leaks.length > 0 || guarded.cleanupError !== undefined) {
        const cleanupOnly = guarded.code === 0 && guarded.leaks.length === 0;
        const leaked = formatLeaks(guarded.leaks).replaceAll('\n', '\n  ');
        const why = cleanupOnly
          ? `\`${lane.label}\` passed, but removing its temp directory failed`
          : guarded.leaks.length === 0
            ? `\`${lane.label}\` failed`
            : guarded.code === 0
              ? `\`${lane.label}\` left temp entries\n  ${leaked}`
              : `\`${lane.label}\` failed and left temp entries\n  ${leaked}`;
        fail(
          'pre-push',
          guarded.cleanupError === undefined ? why : `${why}\n  ${guarded.cleanupError}`,
          guarded.leaks.length > 0
            ? 'remove every temp directory the test lane creates'
            : cleanupOnly
              ? 'resolve the temp directory removal error above'
              : untilGreen(lane),
        );
      }
      ran += 1;
      continue;
    }
    if ((await runLane(lane.command, root)) !== 0) {
      fail('pre-push', `\`${lane.label}\` failed`, untilGreen(lane));
    }
    ran += 1;
  }
  if (ran === 0) {
    // ⛔ NOTHING RAN IS NOT "0 LANES PASSED". A `check` made only of build and smoke lanes (which
    //   CI runs) skips every one, and printing a success line for that certified nothing.
    fail(
      'pre-push',
      'every lane of `check` was skipped, so nothing was checked',
      'put a lint, type or test lane in `check`: only build and smoke lanes are skipped here, because CI runs them',
    );
  }
  const seconds = ((Bun.nanoseconds() - started) / 1e9).toFixed(1);
  ok(`pre-push: ${String(ran)} lane(s) of \`check\` passed in ${seconds}s — CI runs the full gate`);
}
