/**
 * The hooks, run as a hook runs them: a real git index in a scratch repo.
 *
 * ⛔ NOT MOCKED. Both behaviours worth testing are about git's index — that the commit
 *   captures the FORMATTED bytes, and that a half-staged file is never swept in. A test
 *   with a fake `git` would pass while both were wrong.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = new URL('../bin/hooks.ts', import.meta.url).pathname;
const BIN = new URL('../../../node_modules/.bin/', import.meta.url).pathname;
const UGLY = 'export const value  =   {a:1,   b:2}\n';

let repo = '';

async function git(...args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return out;
}

/** Run the hook exactly as `.husky/<name>` does: `bun <runner> <name>` at the repo root. */
async function hook(name: string): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(['bun', RUNNER, name], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: out + err };
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'hf-hook-repo-'));
  await git('init', '--quiet');
  await git('config', 'user.email', 'probe@example.invalid');
  await git('config', 'user.name', 'Probe');
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
  if (repo !== '') await rm(repo, { recursive: true, force: true });
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
});
