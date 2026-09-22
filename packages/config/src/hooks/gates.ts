/**
 * The two gates every HomeFlare repo gets, from one place.
 *
 * ★ THE SPLIT IS BY COST. `pre-commit` touches only the staged files and is measured in
 *   hundreds of milliseconds, so it can run on every commit without anyone resenting
 *   it. `pre-push` runs the repo's own `bun run check` — seconds, once, before the
 *   change costs a slot on the shared self-hosted runner.
 *
 * ⚠️ NEITHER IS A GATE. Both are skippable with `--no-verify` and neither exists in a
 *   fresh clone until `bun install` runs `prepare`. The required checks on `main` stay
 *   the gate; these only make the cheap mistakes cheap to find.
 */
import { fail, note, ok, run, tool } from './report.ts';
import { fingerprints, staged } from './staged.ts';

/**
 * Format and lint what is staged, restaging only what the formatter rewrote.
 *
 * ⚠️ THIS HOOK REWRITES FILES DURING A COMMIT, and it says so on the line where it
 *   happens. Without the restage, oxfmt would fix the worktree while the commit kept
 *   the unformatted bytes — CI then fails on a file that reads as correct locally.
 */
export async function preCommit(root: string): Promise<void> {
  const oxfmt = tool(root, 'oxfmt');
  const { formattable, code, partial } = await staged();

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
  if ((await run([...oxfmt, ...formattable])) !== 0) {
    fail('pre-commit', 'oxfmt could not format the staged files', 'bun run format');
  }
  const after = await fingerprints(formattable);
  const rewritten = formattable.filter((file) => before.get(file) !== after.get(file));

  if (rewritten.length > 0) {
    note(`oxfmt rewrote and restaged ${rewritten.length} file(s): ${rewritten.join(', ')}`);
    if ((await run(['git', 'add', '--', ...rewritten])) !== 0) {
      fail('pre-commit', 'could not restage the formatted files', 'git add the listed files');
    }
  }

  // ⚠️ `--deny-warnings` matches what CI runs. A hook that is laxer than CI is worse
  //   than no hook: it certifies a change CI will reject.
  if (code.length > 0 && (await run([...tool(root, 'oxlint'), '--deny-warnings', ...code])) !== 0) {
    fail(
      'pre-commit',
      `oxlint found problems in ${code.length} staged file(s)`,
      'bun run lint:fix, then fix by hand what remains',
    );
  }

  ok(`pre-commit: ${formattable.length} staged file(s) formatted and linted`);
}

/**
 * Run the repo's own declared gate before the push reaches the runner.
 *
 * ★ IT CALLS `bun run check` RATHER THAN NAMING TOOLS. Every repo's `check` is the
 *   command CI runs; hard-coding `tsc` and `bun test` here would drift from whichever
 *   repo added a step, and the hook would certify a push CI rejects.
 * ⛔ It does not widen a narrow `check`. If a repo's gate only looks at part of the
 *   tree, this hook inherits exactly that blind spot — fix the script, not the hook.
 */
export async function prePush(root: string): Promise<void> {
  const manifest = Bun.file(`${root}/package.json`);
  const pkg = (await manifest.exists())
    ? ((await manifest.json()) as { scripts?: Record<string, string> })
    : {};

  if (pkg.scripts?.['check'] === undefined) {
    note('pre-push: no `check` script declared in package.json; nothing to run');
    return;
  }

  note('pre-push: running `bun run check` — the same gate CI runs');
  const started = Bun.nanoseconds();
  if ((await run(['bun', 'run', 'check'])) !== 0) {
    fail(
      'pre-push',
      'bun run check failed — CI would fail the same way, on a shared runner',
      'bun run lint:fix, then bun run check until it is green',
    );
  }

  ok(`pre-push: bun run check passed in ${((Bun.nanoseconds() - started) / 1e9).toFixed(1)}s`);
}
