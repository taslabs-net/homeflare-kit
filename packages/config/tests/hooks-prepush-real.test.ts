/**
 * pre-push against a REAL `git push`: the committed wrapper, the runner it finds through
 * `node_modules/@homeflare/config`, a real bare remote, and what actually lands on it.
 *
 * 🔴 THE LANES RUN ON THE WORKING TREE, SO THE WORKING TREE MUST BE THE COMMIT. Measured by the
 *   red team on 2026-10-01 with real pushes: a committed, test-breaking change with the old
 *   value restored UNCOMMITTED pushed with exit 0, and so did a committed file that needs an
 *   untracked one. push-range.ts only asked whether the pushed ref was `HEAD`; nothing asked
 *   whether the files on disk were. A runner-level test could not show that the PUSH was
 *   stopped, so these push for real and then ask the remote what it received.
 * ⚠️ NOT MOCKED, and the only stand-in is gitleaks (a shim that finds nothing): CI's runner has
 *   none, and the scan has its own file. Every temp directory is removed in `afterEach`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV,
  type Scratch,
  pathWith,
  realPush,
  removeBins,
  scratchRepo,
  spawn,
  wireHooks,
  withBun,
} from './hooks-harness.ts';

/** `check` passes only while `value.txt` says `good`. */
const CHECK = 'grep -q good value.txt';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await removeBins();
});

type Fixture = { repo: Scratch; remote: string; env: Record<string, string | undefined> };

/** A wired repository with `main` committed and pushed to a bare remote, on branch `feat`. */
async function fixture(check = CHECK): Promise<Fixture> {
  const repo = await scratchRepo('hf-real-push-');
  const remote = await mkdtemp(join(tmpdir(), 'hf-real-remote-'));
  cleanups.push(async () => {
    await repo.remove();
    await rm(remote, { recursive: true, force: true });
  });
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await wireHooks(repo);
  await repo.write('package.json', JSON.stringify({ scripts: { check } }));
  await repo.write('value.txt', 'good\n');
  await repo.git('add', '-A');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
  return { repo, remote, env: { ...ENV, PATH: withBun(await pathWith(0)) } };
}

/** A commit on `feat`: a push with no new file is "nothing to check" and never reaches a lane. */
async function addCommit(repo: Scratch): Promise<void> {
  await repo.write('notes.txt', 'more\n');
  await repo.git('add', 'notes.txt');
  await repo.git('commit', '--quiet', '-m', 'notes');
}

/** Did `feat` reach the remote? */
async function landed(remote: string): Promise<boolean> {
  return (
    (await spawn(['git', '-C', remote, 'rev-parse', '--verify', '--quiet', 'feat'], remote))
      .code === 0
  );
}

describe('a clean working tree', () => {
  test('pushes, and the remote has the branch', async () => {
    const { repo, remote, env } = await fixture();
    await addCommit(repo);

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).toBe(0);
    expect(result.output).toContain('lane(s) of `check` passed');
    expect(await landed(remote)).toBe(true);
  });

  test('a committed change that breaks check still fails on its own merits', async () => {
    // ⚠️ The control: with the tree clean the lanes see the commit, so the failure is the real one.
    const { repo, remote, env } = await fixture();
    await repo.write('value.txt', 'bad\n');
    await repo.git('commit', '--quiet', '-am', 'break it');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('`grep -q good value.txt` failed');
    expect(await landed(remote)).toBe(false);
  });

  test('an IGNORED file is not a difference — node_modules is the install, not the content', async () => {
    const { repo, remote, env } = await fixture();
    await repo.write('.gitignore', 'node_modules\nscratch.log\n');
    await repo.git('commit', '--quiet', '-am', 'ignore a log');
    await repo.write('scratch.log', 'noise\n');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).toBe(0);
    expect(await landed(remote)).toBe(true);
  });
});

describe('a working tree that is not the commit', () => {
  test('the committed break with the old value restored UNCOMMITTED does not push', async () => {
    // 🔴 THE MEASURED CASE. The lanes ran on the restored file and went green, and the remote
    //   received the breaking commit.
    const { repo, remote, env } = await fixture();
    await repo.write('value.txt', 'bad\n');
    await repo.git('commit', '--quiet', '-am', 'break it');
    await repo.write('value.txt', 'good\n');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('the working tree has uncommitted changes');
    expect(result.output).toContain(' M value.txt');
    expect(result.output).toContain('fix:    commit or `git stash -u`, then push');
    expect(result.output).not.toContain('--no-verify');
    expect(await landed(remote)).toBe(false);
  });

  test('a committed file that needs an UNTRACKED one does not push', async () => {
    // 🔴 THE SECOND MEASURED CASE: green here, red for everyone else, because `needs.txt` was
    //   never committed. Untracked files count; `git status --porcelain` lists them as `??`.
    const { repo, remote, env } = await fixture('grep -q good value.txt && test -f needs.txt');
    await addCommit(repo);
    await repo.write('needs.txt', 'only on this disk\n');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('?? needs.txt');
    expect(await landed(remote)).toBe(false);
  });

  test('says how many more when the list is long, and `git stash -u` really does fix it', async () => {
    const { repo, remote, env } = await fixture();
    await addCommit(repo);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await repo.write(`${name}.txt`, 'x\n');

    const refused = await realPush(repo, env, 'origin', 'feat');
    expect(refused.code).not.toBe(0);
    expect(refused.output).toContain('; and 2 more)');
    expect(await landed(remote)).toBe(false);

    await repo.git('stash', 'push', '--quiet', '--include-untracked');
    const accepted = await realPush(repo, env, 'origin', 'feat');
    expect(accepted.code).toBe(0);
    expect(await landed(remote)).toBe(true);
  });
});

describe('a check with nothing left to run', () => {
  // 🔴 A `check` made only of build and smoke lanes — which CI runs, so pre-push skips them —
  //   used to print "0 lane(s) of `check` passed" and exit 0: a success line for a push nothing
  //   had checked. Measured by the red team on 2026-10-01.
  test('FAILS when every lane is skipped, and the push does not happen', async () => {
    const { repo, remote, env } = await fixture('bun run build');
    await repo.write(
      'package.json',
      JSON.stringify({ scripts: { check: 'bun run build', build: 'echo built' } }),
    );
    await repo.git('commit', '--quiet', '-am', 'only a build');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('every lane of `check` was skipped, so nothing was checked');
    expect(result.output).toContain('fix:    put a lint, type or test lane in `check`');
    expect(result.output).not.toContain('0 lane(s)');
    expect(await landed(remote)).toBe(false);
  });

  test('still passes when one lane runs beside a skipped build', async () => {
    const { repo, remote, env } = await fixture();
    await repo.write(
      'package.json',
      JSON.stringify({
        scripts: { check: 'grep -q good value.txt && bun run build', build: 'echo built' },
      }),
    );
    await repo.git('commit', '--quiet', '-am', 'a lane and a build');

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).toBe(0);
    expect(result.output).toContain('1 lane(s) of `check` passed');
    expect(await landed(remote)).toBe(true);
  });
});
