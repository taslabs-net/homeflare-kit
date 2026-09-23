/**
 * pre-push, run as git runs it: a real remote, real refs on stdin, a real `bun test`.
 *
 * ★ WHAT IS PINNED: the push is measured from the right base (a new branch from where it
 *   left main, a second push from what the remote has), only the tests the pushed files can
 *   reach run, a build is left to CI, and every way of losing the base WIDENS the run.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, scratchRepo, spawn } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);

/** A tiny package: two modules, each with the one test that imports it. */
const PROBE = {
  name: 'probe',
  private: true,
  scripts: {
    check: 'bun run lint && bun run build && bun test',
    lint: 'echo LINT-LANE-RAN',
    build: 'echo BUILD-LANE-RAN',
  },
};

function testFile(name: string): string {
  return [
    "import { expect, test } from 'bun:test';",
    `import { value } from './${name}.ts';`,
    `test('${name}', () => {`,
    `  console.log('${name.toUpperCase()}-TEST-RAN');`,
    '  expect(value).toBeGreaterThan(0);',
    '});',
    '',
  ].join('\n');
}

const repo: Scratch = await scratchRepo('hf-push-repo-');
const remote = await mkdtemp(join(tmpdir(), 'hf-push-remote-'));

async function sha(ref = 'HEAD'): Promise<string> {
  return (await repo.git('rev-parse', ref)).trim();
}

async function commit(path: string, text: string): Promise<string> {
  await repo.write(path, text);
  await repo.git('add', '--', path);
  await repo.git('commit', '--quiet', '-m', `edit ${path}`);
  return await sha();
}

const push = (stdin: string, remoteName = 'origin') =>
  repo.hook('pre-push', { args: [remoteName, remote], stdin: `${stdin}\n` });

beforeAll(async () => {
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await repo.write('package.json', JSON.stringify(PROBE, null, 2));
  await repo.write('.gitignore', 'node_modules\n');
  for (const name of ['a', 'b']) {
    await repo.write(`${name}.ts`, 'export const value = 1;\n');
    await repo.write(`${name}.test.ts`, testFile(name));
  }
  await repo.git('add', '.');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
});

afterAll(async () => {
  await repo.remove();
  await rm(remote, { recursive: true, force: true });
});

describe('what a push is measured from', () => {
  test('a new branch: from where it left origin/main — only reachable tests, no build', async () => {
    const tip = await commit('a.ts', 'export const value = 2;\n');
    const result = await push(`refs/heads/feat ${tip} refs/heads/feat ${ZERO}`);

    expect(result.code).toBe(0);
    expect(result.output).toContain('where this branch left origin/main');
    expect(result.output).toContain('LINT-LANE-RAN');
    expect(result.output).toContain('A-TEST-RAN');
    expect(result.output).not.toContain('B-TEST-RAN');
    // ⛔ The build is CI's: named as skipped, never run.
    expect(result.output).toContain('skip bun run build');
    expect(result.output).not.toContain('BUILD-LANE-RAN');
    expect(result.output).toContain('CI runs the full gate');
  });

  test('a second push: from what the remote has — only what this push adds', async () => {
    const before = await sha();
    await repo.git('push', '--quiet', 'origin', 'feat');
    const tip = await commit('b.ts', 'export const value = 3;\n');
    const result = await push(`refs/heads/feat ${tip} refs/heads/feat ${before}`);

    expect(result.code).toBe(0);
    expect(result.output).toContain('what origin has now');
    expect(result.output).toContain('B-TEST-RAN');
    expect(result.output).not.toContain('A-TEST-RAN');
  });

  test('a push that changes package.json runs every test — imports cannot see it', async () => {
    const before = await sha();
    await repo.git('push', '--quiet', 'origin', 'feat');
    const tip = await commit('package.json', JSON.stringify({ ...PROBE, version: '0.0.1' }));
    const result = await push(`refs/heads/feat ${tip} refs/heads/feat ${before}`);

    expect(result.code).toBe(0);
    expect(result.output).toContain('changes what every test runs on');
    expect(result.output).toContain('A-TEST-RAN');
    expect(result.output).toContain('B-TEST-RAN');
  });

  test('deleting a branch checks nothing', async () => {
    const result = await push(`(delete) ${ZERO} refs/heads/feat ${await sha()}`);
    expect(result.code).toBe(0);
    expect(result.output).toContain('only deletes');
    expect(result.output).not.toContain('LINT-LANE-RAN');
  });

  test('a new branch with nothing new checks nothing', async () => {
    const main = await sha('main');
    const result = await push(`refs/heads/same ${main} refs/heads/same ${ZERO}`);
    expect(result.code).toBe(0);
    expect(result.output).toContain('no file differs');
    expect(result.output).not.toContain('LINT-LANE-RAN');
  });

  test('no remote-tracking branch to measure from: every lane runs, tests in full', async () => {
    // ⛔ WIDEN, NEVER NARROW TO NOTHING — see push-range.ts.
    const result = await push(`refs/heads/feat ${await sha()} refs/heads/feat ${ZERO}`, 'nowhere');
    expect(result.code).toBe(0);
    expect(result.output).toContain('tests in full');
    expect(result.output).toContain('A-TEST-RAN');
    expect(result.output).toContain('B-TEST-RAN');
  });
});

describe('what a push reports', () => {
  test('a failing lane fails the push, names the lane, the fix and the bypass', async () => {
    await repo.write(
      'package.json',
      JSON.stringify({ scripts: { check: 'bun run lint', lint: 'exit 3' } }),
    );
    const result = await push(`refs/heads/feat ${await sha()} refs/heads/feat ${ZERO}`, 'nowhere');
    expect(result.code).toBe(1);
    expect(result.output).toContain('`bun run lint` failed');
    expect(result.output).toContain('git push --no-verify');
  });

  test('in a worktree nobody has installed: skipped out loud, not failed', async () => {
    await rm(join(repo.dir, 'node_modules'), { recursive: true, force: true });
    const result = await push(`refs/heads/feat ${await sha()} refs/heads/feat ${ZERO}`);
    expect(result.code).toBe(0);
    expect(result.output).toContain("run 'bun install'");
    await mkdir(join(repo.dir, 'node_modules'));
  });

  test('is a no-op when the repo declares no check script', async () => {
    await repo.write('package.json', JSON.stringify({ name: 'probe' }));
    const result = await push(`refs/heads/feat ${await sha()} refs/heads/feat ${ZERO}`);
    expect(result.code).toBe(0);
    expect(result.output).toContain('no `check` script');
  });

  test('strips the GIT_* a real hook exports before running a lane', async () => {
    // 🔴 THE REGRESSION THIS EXISTS FOR, measured 2026-09-22: git sets GIT_DIR for a hook,
    //   `check` runs the tests, and a test building a throwaway repository then commits into
    //   the repository being pushed — cwd is ignored once GIT_DIR is set.
    // ⚠️ `$GIT_DIR`, not the `${…}` form — oxlint reads that as a botched template literal.
    await repo.write(
      'package.json',
      JSON.stringify({ scripts: { check: 'echo "GIT_DIR=[$GIT_DIR]"' } }),
    );
    const result = await repo.hook('pre-push', {
      args: ['origin', remote],
      env: { ...ENV, GIT_DIR: '/somewhere/else/.git' },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('GIT_DIR=[]');
    expect(result.output).not.toContain('GIT_DIR=[/somewhere');
  });
});
