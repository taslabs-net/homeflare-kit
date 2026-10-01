/**
 * scripts/hooks/actionlint.ts, run the way the kit's pre-commit runs it: a real staged
 * workflow in a scratch repository, and a PATH this test controls.
 *
 * ★ IT FAILS CLOSED, LIKE THE SECRET SCAN (Tim, 2026-10-01). A workflow change with no
 *   `actionlint` to lint it used to print a warning and exit 0, which reads as coverage that
 *   does not exist. Only a commit that STAGES a workflow needs the binary, so a commit that
 *   touches none must still pass on a machine without it.
 * ⚠️ THE PATH HOLDS ONLY `bun`, `git` AND, WHEN A TEST WANTS ONE, A SHIM. A real actionlint
 *   on this machine (CT100 and a Mac with Homebrew both have one) must not decide the
 *   outcome, and `/usr/bin` is no safe floor: Debian packages the binary there.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/hooks/actionlint.ts', import.meta.url).pathname;

const WORKFLOW = '.github/workflows/ci.yml';

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** The environment a hook gets from git, less every `GIT_*`, with `PATH` replaced. */
function envWith(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('GIT_')) env[name] = value;
  }
  return { ...env, PATH: path };
}

async function git(dir: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(['git', '-C', dir, ...args], {
    env: envWith(process.env['PATH'] ?? ''),
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const err = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
}

/** A repository with `staged` files in its index, and a PATH of bun, git and an optional shim. */
async function sandbox(
  staged: readonly string[],
  actionlint: number | 'absent',
): Promise<{ dir: string; path: string }> {
  const dir = await temp('hf-actionlint-repo-');
  await git(dir, 'init', '--quiet', '--initial-branch=main');
  for (const file of staged) {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await Bun.write(join(dir, file), 'name: x\n');
    await git(dir, 'add', '--', file);
  }

  const bin = await temp('hf-actionlint-bin-');
  await symlink(process.execPath, join(bin, 'bun'));
  await symlink(Bun.which('git') ?? '/usr/bin/git', join(bin, 'git'));
  if (actionlint !== 'absent') {
    await Bun.write(
      join(bin, 'actionlint'),
      `#!/bin/sh\necho "shim ran: $*"\nexit ${actionlint}\n`,
    );
    await chmod(join(bin, 'actionlint'), 0o755);
  }
  return { dir, path: bin };
}

async function run(dir: string, path: string): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn([process.execPath, SCRIPT], {
    cwd: dir,
    env: envWith(path),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: out + err };
}

describe('actionlint, run by the kit pre-commit', () => {
  test('a staged workflow and no actionlint FAILS, naming the install', async () => {
    const { dir, path } = await sandbox([WORKFLOW], 'absent');
    const result = await run(dir, path);

    expect(result.code).toBe(1);
    expect(result.output).toContain('NOT linted');
    expect(result.output).toContain('brew install actionlint');
    expect(result.output).toContain('1.7.12');
    expect(result.output).not.toContain('--no-verify');
    expect(result.output.toLowerCase()).not.toContain('bypass');
  });

  test('no workflow staged: passes without the binary, because nothing needs linting', async () => {
    const { dir, path } = await sandbox(['README.md'], 'absent');
    const result = await run(dir, path);

    expect(result.code).toBe(0);
    expect(result.output).toContain('no workflow changes');
  });

  test('a staged workflow and a clean actionlint passes', async () => {
    const { dir, path } = await sandbox([WORKFLOW], 0);
    const result = await run(dir, path);

    expect(result.code).toBe(0);
    expect(result.output).toContain('shim ran: -color');
    expect(result.output).toContain('1 workflow file(s) clean');
  });

  test('a staged workflow that actionlint rejects FAILS, with the fix and no way round', async () => {
    const { dir, path } = await sandbox([WORKFLOW], 1);
    const result = await run(dir, path);

    expect(result.code).toBe(1);
    expect(result.output).toContain('actionlint found problems');
    expect(result.output).toContain('fix:');
    expect(result.output).not.toContain('--no-verify');
  });
});
