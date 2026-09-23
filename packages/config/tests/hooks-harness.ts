/**
 * A throwaway git repository, and the hook runner run inside it the way git runs it.
 *
 * ⛔ NOT MOCKED. What the hooks promise is about git — the index a commit captures, the
 *   refs a push names, the worktree a hook runs in — and a fake `git` would pass while all
 *   of it was wrong.
 * 🔴 EVERY `git` HERE DROPS THE INHERITED `GIT_*` AND NAMES ITS REPOSITORY WITH `-C`.
 *   Measured 2026-09-22, at the cost of two junk files and a stray commit on this
 *   repository's `main`: the pre-push hook exports `GIT_DIR`/`GIT_INDEX_FILE`, these tests
 *   ran inside `bun run check` under that hook, and `git commit` in the throwaway repo
 *   committed HERE instead — `cwd` is ignored once `GIT_DIR` is set. Identity, signing and
 *   hooks are passed with `-c` for the same reason: `git config` wrote into the real repo.
 */
import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUNNER: string = new URL('../bin/hooks.ts', import.meta.url).pathname;
const BIN = new URL('../../../node_modules/.bin/', import.meta.url).pathname;

/** This process's environment, minus anything a hook exported. */
export const ENV: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_') && name !== 'CI'),
);

const CONFIG = [
  '-c',
  'user.name=Probe',
  '-c',
  'user.email=probe@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

export type Result = { readonly code: number; readonly output: string };

export type Scratch = {
  readonly dir: string;
  /** `git -C <dir>`; throws on failure, returns stdout. */
  readonly git: (...args: readonly string[]) => Promise<string>;
  /** Write a file, relative to the repository. */
  readonly write: (path: string, text: string) => Promise<void>;
  /** Run `bun bin/hooks.ts <name> …args` at the root, with `stdin` piped in. */
  readonly hook: (
    name: string,
    options?: { env?: Record<string, string | undefined>; args?: string[]; stdin?: string },
  ) => Promise<Result>;
  readonly remove: () => Promise<void>;
};

export async function spawn(
  cmd: readonly string[],
  cwd: string,
  env: Record<string, string | undefined> = ENV,
  stdin = '',
): Promise<Result> {
  const proc = Bun.spawn([...cmd], {
    cwd,
    env,
    stdin: new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: out + err };
}

/**
 * A repository in a fresh temp directory, with oxfmt/oxlint linked in so the runner never
 * reaches the network through its `bunx` fallback.
 */
export async function scratchRepo(prefix = 'hf-hook-repo-'): Promise<Scratch> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const git = async (...args: readonly string[]): Promise<string> => {
    const result = await spawn(['git', '-C', dir, ...CONFIG, ...args], dir);
    if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.output}`);
    return result.output;
  };
  await git('init', '--quiet', '--initial-branch=main');
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  for (const name of ['oxfmt', 'oxlint']) {
    await symlink(join(BIN, name), join(dir, 'node_modules/.bin', name));
  }
  await Bun.write(join(dir, '.oxfmtrc.json'), JSON.stringify({ singleQuote: true }));
  return {
    dir,
    git,
    write: async (path, text) => void (await Bun.write(join(dir, path), text)),
    hook: async (name, options = {}) =>
      await spawn(
        [process.execPath, RUNNER, name, ...(options.args ?? [])],
        dir,
        options.env ?? ENV,
        options.stdin ?? '',
      ),
    remove: async () => await rm(dir, { recursive: true, force: true }),
  };
}

/**
 * A PATH whose `gitleaks` exits with the given code, in front of the caller's PATH — or,
 * for `'absent'`, a PATH of only `bun`, `git` and the system directories.
 * ★ A SHIM, NOT THE REAL BINARY: CI's runner has no gitleaks, and a real finding would need
 *   a secret-shaped string in this file, which the repository's own scan would then flag.
 * ⚠️ THE CALLER'S PATH STAYS BEHIND THE SHIM: `node_modules/.bin/oxfmt` is a
 *   `#!/usr/bin/env node` launcher, so a PATH without node would fail the formatter, not the
 *   thing under test. `'absent'` can drop it because the hook stops before formatting.
 */
export async function pathWith(gitleaks: number | 'absent'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-hook-bin-'));
  const git = Bun.which('git');
  if (git !== null) await symlink(git, join(dir, 'git'));
  await symlink(process.execPath, join(dir, 'bun'));
  if (gitleaks === 'absent') return [dir, '/usr/bin', '/bin'].join(':');
  await Bun.write(join(dir, 'gitleaks'), `#!/bin/sh\nexit ${String(gitleaks)}\n`);
  await chmod(join(dir, 'gitleaks'), 0o755);
  return `${dir}:${process.env['PATH'] ?? ''}`;
}
