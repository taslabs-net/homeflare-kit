/**
 * Activation: one `bun install` turns the tracked hooks on for the clone and every worktree.
 *
 * 🔴 THE PROPERTY THAT MATTERS IS THE LAST TEST. husky's `.husky/_` left every worktree an
 *   agent made with `git worktree add` without hooks, silently; the fix is only a fix if a
 *   brand-new worktree, never installed, runs the hook on its first commit.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateHooks } from '../src/hooks/activate.ts';
import { ENV, RUNNER, type Scratch, scratchRepo, spawn } from './hooks-harness.ts';

/** Identity and signing pinned, hooks NOT overridden — this commit must run them. */
const UNSIGNED = [
  '-c',
  'user.name=Probe',
  '-c',
  'user.email=probe@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const repos: Scratch[] = [];
const extra: string[] = [];

/** A repo whose tracked `.husky/pre-commit` drops a marker in the worktree it runs in. */
async function withTrackedHook(): Promise<Scratch> {
  const repo = await scratchRepo('hf-activate-');
  repos.push(repo);
  await mkdir(join(repo.dir, '.husky'), { recursive: true });
  await repo.write('.husky/pre-commit', 'echo ran > "$(pwd)/hook-ran"\n');
  await chmod(join(repo.dir, '.husky/pre-commit'), 0o755);
  await repo.git('add', '.husky');
  await repo.git('commit', '--quiet', '-m', 'hooks');
  return repo;
}

const hooksPath = async (repo: Scratch) =>
  (
    await spawn(['git', '-C', repo.dir, 'config', '--get', 'core.hooksPath'], repo.dir)
  ).output.trim();

afterAll(async () => {
  for (const repo of repos) await repo.remove();
  for (const dir of extra) await rm(dir, { recursive: true, force: true });
});

describe('activateHooks', () => {
  test('points core.hooksPath at the tracked .husky, replacing husky’s .husky/_', async () => {
    const repo = await withTrackedHook();
    await repo.git('config', 'core.hooksPath', '.husky/_');
    const result = await activateHooks(repo.dir, ENV);
    expect(result).toEqual({
      active: true,
      message: 'core.hooksPath .husky/_ → .husky, for every worktree of this clone',
    });
    expect(await hooksPath(repo)).toBe('.husky');
    expect((await activateHooks(repo.dir, ENV)).message).toBe('core.hooksPath is already .husky');
  });

  test('stays off under CI — CI runs the real gate', async () => {
    const repo = await withTrackedHook();
    const result = await activateHooks(repo.dir, { ...ENV, CI: 'true' });
    expect(result.active).toBe(false);
    expect(await hooksPath(repo)).toBe('');
  });

  test('does nothing, and does not fail, outside a git work tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-activate-nogit-'));
    extra.push(dir);
    expect(await activateHooks(dir, ENV)).toEqual({
      active: false,
      message: 'not a git work tree — nothing to do',
    });
  });

  test('does nothing when there is no tracked hook to point at', async () => {
    const repo = await scratchRepo('hf-activate-empty-');
    repos.push(repo);
    expect((await activateHooks(repo.dir, ENV)).active).toBe(false);
    expect(await hooksPath(repo)).toBe('');
  });

  test('a package below the root points at ITS .husky, relative to the top', async () => {
    const repo = await scratchRepo('hf-activate-sub-');
    repos.push(repo);
    await mkdir(join(repo.dir, 'pkg/.husky'), { recursive: true });
    await repo.write('pkg/.husky/pre-push', 'exit 0\n');
    await activateHooks(join(repo.dir, 'pkg'), ENV);
    expect(await hooksPath(repo)).toBe('pkg/.husky');
  });

  test('the runner’s `activate` exits 0 whatever happens — it runs inside bun install', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-activate-cli-'));
    extra.push(dir);
    const result = await spawn([process.execPath, RUNNER, 'activate'], dir);
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing to do');
  });
});

describe('every worktree', () => {
  test('a fresh `git worktree add`, never installed, runs the tracked hook', async () => {
    const repo = await withTrackedHook();
    await activateHooks(repo.dir, ENV);

    const worktree = `${repo.dir}-wt`;
    extra.push(worktree);
    await repo.git('worktree', 'add', '--quiet', '-b', 'agent', worktree);
    const made = await spawn(
      ['git', '-C', worktree, ...UNSIGNED, 'commit', '--allow-empty', '--quiet', '-m', 'x'],
      worktree,
    );

    expect(made.code).toBe(0);
    // ★ The marker is in the WORKTREE: git ran that worktree's own checked-out .husky.
    expect(await Bun.file(join(worktree, 'hook-ran')).exists()).toBe(true);
  });

  test('the husky shape it replaces: .husky/_ runs nothing in a fresh worktree', async () => {
    // 🔴 THE BUG, kept as a control. husky generates `.husky/_` (gitignored) where it runs;
    //   the shared config then points every OTHER worktree at a directory it lacks.
    const repo = await withTrackedHook();
    await repo.git('config', 'core.hooksPath', '.husky/_');
    await mkdir(join(repo.dir, '.husky/_'), { recursive: true });
    await repo.write('.husky/_/pre-commit', 'echo ran > "$(pwd)/hook-ran"\n');
    await chmod(join(repo.dir, '.husky/_/pre-commit'), 0o755);

    const worktree = `${repo.dir}-husky-wt`;
    extra.push(worktree);
    await repo.git('worktree', 'add', '--quiet', '-b', 'agent', worktree);
    const made = await spawn(
      ['git', '-C', worktree, ...UNSIGNED, 'commit', '--allow-empty', '--quiet', '-m', 'x'],
      worktree,
    );

    expect(made.code).toBe(0);
    expect(await Bun.file(join(worktree, 'hook-ran')).exists()).toBe(false);
  });
});
