/**
 * pre-push does not take "no leaks found" on trust: a REAL push, with a scanner or a git that
 * cannot be believed, must fail closed.
 *
 * 🔴 gitleaks 8.30.1 EXITS 0 AND PRINTS "no leaks found" WHEN ITS OWN `git log` FAILS. Measured by
 *   the red team on 2026-10-01 with a real `git push "/path/remote 3.git"`: gitleaks splits
 *   `--log-opts` on spaces, git failed, the hook printed a tick, and a secret landed. The hook
 *   lists the same range with git first and reads gitleaks's stderr (gitleaks.ts).
 * ★ SHIMS FOR BOTH, because CI has no gitleaks and no old git. The real-gitleaks version of the
 *   spaced-path push is in hooks-prepush-secrets-real.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { ENV, pathWith, realPush, removeBins, useOldGit, withBun } from './hooks-harness.ts';
import { cleanFixtures, commit, fixture, remoteRef } from './hooks-secrets-fixture.ts';

afterEach(async () => {
  await cleanFixtures();
  await removeBins();
});

describe('a REAL push when the scanner cannot be trusted', () => {
  const failed =
    '2:30PM ERR [git] fatal: bad object deadbeef\n2:30PM ERR error="stderr is not empty"\n' +
    '2:30PM INF 0 commits scanned.\n2:30PM INF no leaks found';

  test('gitleaks that says ERR and exits 0 FAILS the push — the secret may have gone unread', async () => {
    // 🔴 THE MEASURED SHAPE: 8.30.1 exits 0 and ends "no leaks found" when its own git fails.
    const { repo, remote } = await fixture();
    await commit(repo, 'a.txt', 'a\n');
    const env = { ...ENV, PATH: withBun(await pathWith(0, { say: failed })) };

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('gitleaks reported an error');
    expect(result.output).toContain('NOT reliably scanned');
    expect(result.output).toContain('[git] fatal: bad object deadbeef');
    expect(result.output).not.toContain('--no-verify');
    expect(await remoteRef(remote, 'feat')).toBeUndefined();
  });

  test('the same shim saying only INF lines passes — it is not over-matching', async () => {
    const { repo, remote } = await fixture();
    await commit(repo, 'a.txt', 'a\n');
    const say = '2:30PM INF 1 commits scanned.\n2:30PM INF no leaks found';
    const env = { ...ENV, PATH: withBun(await pathWith(0, { say })) };

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).toBe(0);
    expect(await remoteRef(remote, 'feat')).toBeDefined();
  });

  test('a git too old for --diff-merges=remerge FAILS the push, closed, naming the version', async () => {
    const { repo, remote } = await fixture();
    await useOldGit(repo);
    await commit(repo, 'a.txt', 'a\n');
    const env = { ...ENV, PATH: withBun(await pathWith(0)) };

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('git could not list the commits being pushed');
    expect(result.output).toContain('needs git 2.36 or newer');
    expect(await remoteRef(remote, 'feat')).toBeUndefined();
  });

  test('a git that fails SILENTLY still gives a reason: the exit code, never "NOT scanned ()"', async () => {
    const { repo, remote } = await fixture();
    await useOldGit(repo, 'exit 3');
    await commit(repo, 'a.txt', 'a\n');
    const env = { ...ENV, PATH: withBun(await pathWith(0)) };

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('(git log exited 3 and said nothing)');
    expect(result.output).not.toContain('NOT scanned ()');
    expect(await remoteRef(remote, 'feat')).toBeUndefined();
  });

  // 🔴 `[git]` is gitleaks's component marker only right after the level. Read anywhere on a line
  //   it blocked a clean push: here a WRN line whose message names a path under `docs/[git]/`.
  test('a WRN line that merely mentions [git] in a path is NOT an error — the push goes through', async () => {
    const { repo, remote } = await fixture();
    await commit(repo, 'a.txt', 'a\n');
    const say = '2:30PM INF 1 commits scanned.\n2:30PM WRN skipping docs/[git]/notes.md: too large';
    const env = { ...ENV, PATH: withBun(await pathWith(0, { say })) };

    const result = await realPush(repo, env, 'origin', 'feat');

    expect(result.code).toBe(0);
    expect(result.output).not.toContain('gitleaks reported an error');
    expect(await remoteRef(remote, 'feat')).toBeDefined();
  });
});
