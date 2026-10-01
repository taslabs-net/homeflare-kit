/**
 * The two gates every HomeFlare repo gets, from one place.
 *
 * ★ THE SPLIT IS BY COST. `pre-commit` touches only the staged files — a secret scan, then
 *   format and lint — and is measured in hundreds of milliseconds, so it can run on every
 *   commit without anyone resenting it. `pre-push` runs the repository's own `check`
 *   narrowed to what the push can affect (push-plan.ts): seconds, once per push.
 * ⛔ BOTH FAIL CLOSED (Tim, 2026-10-01). A hook that cannot do its job — no `node_modules`, no
 *   gitleaks, a push it cannot check — stops the commit or push and names the fix. A gate
 *   that cannot run is fixed, never skipped, and no message here offers a way round it.
 *   CI is still the full gate: it runs the whole `check`, every test, the build and the
 *   smoke test on every pull request.
 */
import { existsSync } from 'node:fs';
import { resolveOxfmtConfig } from './oxfmt-config.ts';
import { type Lane, planLanes } from './push-plan.ts';
import { checkoutFix } from './push-fix.ts';
import { changesEverything, parsePushRefs, pushScope } from './push-range.ts';
import { fail, note, ok, run, runCaptured, runLane, tool } from './report.ts';
import { scanStagedSecrets } from './secrets.ts';
import { fingerprints, staged } from './staged.ts';

/**
 * oxfmt's own summary line ("Finished in 2ms on 0 files using 10 threads.") is how the hook
 * learns whether `--no-error-on-unmatched-pattern` turned a real run into a no-op — oxfmt has
 * no flag that answers this more directly. `null` (unparsable — a future oxfmt wording change)
 * is treated as "something ran": that is the safe direction, since it only ever suppresses the
 * new "no formattable staged files" message, never a real failure.
 */
function matchedFileCount(stdout: string): number | null {
  const match = /\bon (\d+) files? using/.exec(stdout);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Format and lint what is staged, restaging only what the formatter rewrote.
 *
 * ⚠️ THIS HOOK REWRITES FILES DURING A COMMIT, and it says so on the line where it
 *   happens. Without the restage, oxfmt would fix the worktree while the commit kept
 *   the unformatted bytes — CI then fails on a file that reads as correct locally.
 */
/**
 * Has `bun install` run in this worktree? Fails the hook if not.
 *
 * ⛔ WITHOUT IT, FAIL — NEVER SKIP, NEVER IMPROVISE. A fresh worktree runs its hooks
 *   (activate.ts), and in the repo that HOSTS this package they are reached by workspace
 *   path, not through node_modules. There `tool()` would fall back to `bunx`, fetching an
 *   unpinned oxfmt mid-commit, and a pre-push lane would die on "command not found". The
 *   alternative, letting the commit through unchecked, is a gate that quietly is not one.
 *   The wrapper every other repo commits makes the same call one step earlier (install.ts).
 */
function requireInstalled(root: string, hook: 'pre-commit' | 'pre-push'): void {
  if (existsSync(`${root}/node_modules`)) return;
  fail(
    hook,
    'no node_modules in this worktree, so the checks cannot run',
    "run 'bun install' in this worktree",
  );
}

export async function preCommit(root: string): Promise<void> {
  // ⛔ SECRETS FIRST, before anything can rewrite or pass — see secrets.ts. It needs only the
  //   gitleaks binary, so it runs even in a worktree nobody has installed yet.
  await scanStagedSecrets();
  requireInstalled(root, 'pre-commit');

  const { formattable, code, partial } = await staged();

  // ⚠️ BEFORE RESOLVING A CONFIG: if oxfmt would never run (nothing formattable staged, not
  //   even a partially-staged one to `--check`), a config problem — even an unresolved
  //   ambiguous one — must not block the commit. That is the exact shape of BUG 1: don't
  //   fail on "there is nothing to do here".
  if (formattable.length === 0 && partial.length === 0) {
    ok('pre-commit: nothing staged to format');
    return;
  }

  const config = await resolveOxfmtConfig(root);
  if (config.kind === 'ambiguous') {
    fail(
      'pre-commit',
      `${String(config.files.length)} oxfmt configs found (${config.files.join(', ')}) and oxfmt auto-discovers none of them`,
      'keep exactly one .oxfmtrc.* file at the repo root (.oxfmtrc.json is auto-discovered)',
    );
  }
  // ⛔ BUG, MEASURED 2026-09-23: bare `oxfmt` only finds `.oxfmtrc.json`/`.oxfmtrc.jsonc` on
  //   its own — see oxfmt-config.ts. `--config` is added only when the repo's config needs it.
  const oxfmt = [
    ...tool(root, 'oxfmt'),
    ...(config.kind === 'explicit' ? ['--config', config.path] : []),
    // ⛔ BUG, MEASURED 2026-09-23: a staged file wholly excluded by oxfmt's OWN
    //   `ignorePatterns` (house `packages/distilled-*/src/**`, say) made oxfmt exit non-zero
    //   with "Expected at least one target file" — `staged()` classifies by extension only,
    //   blind to the repo's ignore rules, so `formattable`/`code` can be 100% ignored files.
    //   This flag is oxfmt's own documented answer (`--help`, oxfmt 0.68.0): still fail on a
    //   real formatting problem, but not on "everything here was excluded".
    '--no-error-on-unmatched-pattern',
  ];
  const oxlint = [...tool(root, 'oxlint'), '--no-error-on-unmatched-pattern'];

  // ⛔ Checked, never rewritten — see staged.ts for why `git add` here would be theft.
  if (partial.length > 0) {
    note(`${partial.length} staged file(s) also have unstaged edits; checking without rewriting`);
    if ((await run([...oxfmt, '--check', ...partial])) !== 0) {
      fail(
        'pre-commit',
        'those partially staged files are unformatted, and rewriting them would stage your unstaged work',
        'bun run format, then stage the files you meant to commit',
      );
    }
  }

  if (formattable.length === 0) {
    ok('pre-commit: nothing staged to format');
    return;
  }

  const before = await fingerprints(formattable);
  const { code: fmtExit, stdout: fmtOut } = await runCaptured([...oxfmt, ...formattable]);
  if (fmtExit !== 0) {
    fail('pre-commit', 'oxfmt could not format the staged files', 'bun run format');
  }
  const matched = matchedFileCount(fmtOut);

  if (matched !== 0) {
    const after = await fingerprints(formattable);
    const rewritten = formattable.filter((file) => before.get(file) !== after.get(file));

    if (rewritten.length > 0) {
      note(`oxfmt rewrote and restaged ${rewritten.length} file(s): ${rewritten.join(', ')}`);
      if ((await run(['git', 'add', '--', ...rewritten])) !== 0) {
        fail('pre-commit', 'could not restage the formatted files', 'git add the listed files');
      }
    }
  }

  // ⚠️ `--deny-warnings` matches what CI runs. A hook that is laxer than CI is worse
  //   than no hook: it certifies a change CI will reject. Same ignore-rules shape as oxfmt
  //   above: `code` can be entirely excluded by oxlint's own `ignorePatterns`.
  if (code.length > 0 && (await run([...oxlint, '--deny-warnings', ...code])) !== 0) {
    fail(
      'pre-commit',
      `oxlint found problems in ${code.length} staged file(s)`,
      'bun run lint:fix, then fix by hand what remains',
    );
  }

  if (matched === 0) {
    note(
      `${String(formattable.length)} staged file(s) matched a formattable extension, but all are excluded by ignore rules`,
    );
    ok('pre-commit: no formattable staged files');
  } else {
    ok(`pre-commit: ${formattable.length} staged file(s) formatted and linted`);
  }
}

/** The one-line reason a lane is in the run, printed before it starts. */
function describe(lane: Lane): string {
  if (lane.kind === 'skip') return `skip ${lane.label} — ${lane.why}`;
  if (lane.kind === 'test' && lane.scoped)
    return `run  ${lane.command}  (only the tests the push can reach)`;
  if (lane.kind === 'test') return `run  ${lane.command}  (IN FULL)`;
  return `run  ${lane.command}`;
}

/**
 * Run the repository's own `check`, narrowed to what the push can affect.
 *
 * ★ `args` ARE GIT'S: the remote name and URL. `stdin` is git's ref list — see
 *   push-range.ts for how the base is chosen and why it never narrows to nothing.
 * ⛔ A REPO WITH NO `check` SCRIPT FAILS: with nothing to run there is no gate to pass.
 * ⛔ IT DOES NOT CERTIFY WHAT CI WILL SAY. It certifies that `check`'s own lint and type
 *   lanes pass and that every test the pushed files can reach passes. The build, the smoke
 *   test and the unreachable tests are CI's, and the success line says so.
 */
export async function prePush(root: string, args: readonly string[], stdin: string): Promise<void> {
  const manifest = Bun.file(`${root}/package.json`);
  const pkg = (await manifest.exists())
    ? ((await manifest.json()) as { scripts?: Record<string, string> })
    : {};
  const scripts = pkg.scripts ?? {};
  if (scripts['check'] === undefined) {
    // ⛔ NO `check` IS NO GATE, SO IT FAILS (Tim, 2026-10-01). It used to say "nothing to run"
    //   and exit 0, which read as a pass on a repo that had no checks at all.
    fail(
      'pre-push',
      'this repo has no `check` script, so pre-push has nothing to run',
      'add one to package.json — the lint, type and test lanes CI runs — and push again',
    );
  }
  requireInstalled(root, 'pre-push');

  const scope = await pushScope(root, args[0] ?? 'origin', parsePushRefs(stdin));
  if (scope.kind === 'empty') {
    ok(`pre-push: ${scope.why} — nothing to check`);
    return;
  }
  if (scope.kind === 'elsewhere') {
    // ⛔ IT CANNOT CHECK THIS PUSH, SO IT FAILS (Tim, 2026-10-01). A pushed commit is not the
    //   working tree; running the lanes would certify content nobody checked, and reporting
    //   "not checked" while exiting 0 let exactly that content through. That holds for ONE
    //   such ref in a push of several, even with the checked-out one alongside it. A gate
    //   that cannot run is fixed, never skipped: the fix is a checkout per ref (push-fix.ts).
    fail('pre-push', scope.why, checkoutFix(scope.refs, scope.here));
  }
  let base: string | undefined;
  if (scope.kind === 'unscoped') {
    note(`pre-push: ${scope.why} — every lane runs, tests in full`);
  } else {
    const global = scope.changed.filter(changesEverything);
    note(`pre-push: ${String(scope.changed.length)} file(s) changed ${scope.why}`);
    if (global.length > 0)
      note(`  ${global.join(', ')} changes what every test runs on — tests in full`);
    else base = scope.base;
  }

  const lanes = planLanes(scripts, base);
  const started = Bun.nanoseconds();
  let ran = 0;
  for (const lane of lanes) {
    note(describe(lane));
    if (lane.kind === 'skip') continue;
    // 🔴 `runLane` strips the GIT_* this hook inherited — see report.ts.
    if ((await runLane(lane.command, root)) !== 0) {
      fail('pre-push', `\`${lane.label}\` failed`, `${lane.command} — until it is green`);
    }
    ran += 1;
  }
  const seconds = ((Bun.nanoseconds() - started) / 1e9).toFixed(1);
  ok(`pre-push: ${String(ran)} lane(s) of \`check\` passed in ${seconds}s — CI runs the full gate`);
}
