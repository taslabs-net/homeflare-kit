/**
 * The hooks, run as a hook runs them: a real git index in a scratch repo.
 *
 * ⛔ NOT MOCKED. Both behaviours worth testing are about git's index — that the commit
 *   captures the FORMATTED bytes, and that a half-staged file is never swept in. A test
 *   with a fake `git` would pass while both were wrong.
 *
 * 🔴 EVERY `git` HERE DROPS THE INHERITED `GIT_*` AND NAMES ITS REPOSITORY WITH `-C`.
 *   Measured 2026-09-22, at the cost of two junk files and a stray commit on this
 *   repository's `main`: the pre-push hook exports `GIT_DIR`/`GIT_INDEX_FILE`, this file
 *   ran inside `bun run check` under that hook, and `git commit` in the throwaway repo
 *   committed HERE instead — `cwd` is ignored once `GIT_DIR` is set. The identity is
 *   passed with `-c` for the same reason: `git config` wrote into the real repository.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = new URL('../bin/hooks.ts', import.meta.url).pathname;
const BIN = new URL('../../../node_modules/.bin/', import.meta.url).pathname;
const UGLY = 'export const value  =   {a:1,   b:2}\n';

/**
 * ⛔ TOP-LEVEL, NOT A `let` FILLED BY `beforeAll`. If a hook ever throws before the
 *   assignment, a `let repo = ''` makes every path in this file relative to the process
 *   working directory — which is this repository.
 */
const repo = await mkdtemp(join(tmpdir(), 'hf-hook-repo-'));

/** The environment a git call gets: this process's, minus anything a hook exported. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

const IDENTITY = ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid'];

async function git(...args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-C', repo, ...IDENTITY, ...args], {
    cwd: repo,
    env: ENV,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return out;
}

/** Run the hook exactly as `.husky/<name>` does: `bun <runner> <name>` at the repo root. */
async function hook(
  name: string,
  env: Record<string, string | undefined> = ENV,
): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(['bun', RUNNER, name], {
    cwd: repo,
    env: { ...env, ...IDENTITY_ENV },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: out + err };
}

const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'Probe',
  GIT_AUTHOR_EMAIL: 'probe@example.invalid',
  GIT_COMMITTER_NAME: 'Probe',
  GIT_COMMITTER_EMAIL: 'probe@example.invalid',
};

beforeAll(async () => {
  await git('init', '--quiet');
  // ⚠️ The runner resolves oxfmt/oxlint from the PROJECT's node_modules/.bin and only
  //   falls back to `bunx`, which would hit the registry. Link the real binaries so the
  //   test never reaches the network.
  await mkdir(join(repo, 'node_modules/.bin'), { recursive: true });
  for (const name of ['oxfmt', 'oxlint']) {
    await symlink(join(BIN, name), join(repo, 'node_modules/.bin', name));
  }
  await Bun.write(join(repo, '.oxfmtrc.json'), JSON.stringify({ singleQuote: true }));
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('pre-commit', () => {
  test('passes with nothing staged and says so', async () => {
    const result = await hook('pre-commit');
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing staged');
  });

  test('formats a staged file and restages it, so the COMMIT holds the formatted bytes', async () => {
    await Bun.write(join(repo, 'ugly.ts'), UGLY);
    await git('add', 'ugly.ts');

    const result = await hook('pre-commit');
    expect(result.code).toBe(0);
    // ⚠️ The hook rewrites files during a commit; it must say which ones.
    expect(result.output).toContain('rewrote and restaged');
    expect(result.output).toContain('ugly.ts');

    // 🔴 THE REGRESSION THIS EXISTS FOR: formatting the worktree without restaging
    //   leaves the index holding the unformatted bytes, and CI fails a file that reads
    //   as clean locally. Read the index, not the worktree.
    expect(await git('show', ':ugly.ts')).not.toBe(UGLY);
    expect(await git('show', ':ugly.ts')).toBe(await Bun.file(join(repo, 'ugly.ts')).text());
  });

  test('handles a path git would quote and escape', async () => {
    // 🔴 Measured 2026-09-22: without `-z`, `git diff --cached --name-only` applies
    //   core.quotePath and hands back the literal `"caf\303\251 .ts"` — a path that does
    //   not exist. oxfmt then fails on every commit touching the file, saying something
    //   about the wrong name, and the obvious response is `--no-verify`.
    const awkward = 'café note.md';
    await Bun.write(join(repo, awkward), '#  Heading\n\n\ntext\n');
    await git('add', '--', awkward);

    const result = await hook('pre-commit');

    expect(result.code).toBe(0);
    expect(result.output).toContain(awkward);
    expect(await git('show', `:${awkward}`)).toBe(await Bun.file(join(repo, awkward)).text());
  });

  test('refuses a half-staged unformatted file instead of staging the unstaged work', async () => {
    const keep = join(repo, 'partial.ts');
    await Bun.write(keep, "export const a = 'formatted';\n");
    await git('add', 'partial.ts');
    await git('commit', '--quiet', '--no-verify', '-m', 'seed');

    await Bun.write(keep, "export const a = 'staged';\n");
    await git('add', 'partial.ts');
    // Unstaged work on top of a staged change: the file is now only half in the index.
    const dirty = `export const a = 'staged';\nexport const b  =  {c:1}\n`;
    await Bun.write(keep, dirty);

    const result = await hook('pre-commit');
    expect(result.code).toBe(1);
    expect(result.output).toContain('unstaged');
    // ⛔ The work in progress must be exactly as it was. A `git add` here is theft.
    expect(await Bun.file(keep).text()).toBe(dirty);
    expect(await git('show', ':partial.ts')).toBe("export const a = 'staged';\n");
  });
});

describe('pre-push', () => {
  test('is a no-op when the repo declares no check script', async () => {
    const result = await hook('pre-push');
    expect(result.code).toBe(0);
    expect(result.output).toContain('no `check` script');
  });

  test("fails the push when the repo's own check fails, and names the bypass", async () => {
    await Bun.write(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'probe', scripts: { check: 'exit 3' } }),
    );
    const result = await hook('pre-push');
    expect(result.code).toBe(1);
    expect(result.output).toContain('CI would fail the same way');
    expect(result.output).toContain('git push --no-verify');
  });

  test('passes the push when check passes', async () => {
    await Bun.write(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'probe', scripts: { check: 'true' } }),
    );
    const result = await hook('pre-push');
    expect(result.code).toBe(0);
    expect(result.output).toContain('bun run check passed');
  });

  test('strips the GIT_* a real hook exports before running the test suite', async () => {
    // 🔴 THE REGRESSION THIS EXISTS FOR, measured 2026-09-22: git sets GIT_DIR and
    //   GIT_INDEX_FILE for a hook, `check` runs the tests, and a test building a
    //   throwaway repository then commits into the repository being pushed — cwd is
    //   ignored once GIT_DIR is set. Two junk files and a stray commit reached this
    //   repository's main that way.
    await Bun.write(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'probe',
        // ⚠️ `$GIT_DIR`, not the `${…}` form — oxlint reads that as a botched template
        //   literal, and the plain form expands to nothing when the variable is gone.
        scripts: { check: 'echo "GIT_DIR=[$GIT_DIR]"' },
      }),
    );

    const result = await hook('pre-push', { ...ENV, GIT_DIR: '/somewhere/else/.git' });

    expect(result.code).toBe(0);
    expect(result.output).toContain('GIT_DIR=[]');
    expect(result.output).not.toContain('somewhere/else');
  });
});
