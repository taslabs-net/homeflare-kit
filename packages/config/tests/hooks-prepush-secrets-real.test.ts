/**
 * pre-push against the REAL gitleaks and REAL pushes to a bare remote: what it catches, and what
 * it must not flag. Skipped where gitleaks is absent (CI's runner has none); it runs on every
 * machine that has one — CT100 and a Mac with Homebrew both do. The same scan is pinned
 * everywhere with a shim in hooks-prepush-secrets.test.ts.
 *
 * 🔴 EVERY CASE HERE WAS MEASURED BY THE RED TEAM ON 2026-10-01 AS A SECRET THAT REACHED THE REMOTE
 *   WITH EXIT 0 (or a clean push refused), and each fails against the commit before its fix:
 *   a cherry-pick (pre-commit never ran); a token added inside a MERGE commit, which `git log -p`
 *   shows no diff for; a remote path with a space, where gitleaks split `--log-opts` and its own
 *   git failed; a push by URL or to a new remote, which scanned the whole history and failed on
 *   old findings; and a stale remote-tracking ref that excluded a commit the remote had deleted.
 * ⛔ THE TOKEN IS BUILT AT RUNTIME (hooks-secrets-fixture.ts) — never a literal in this file.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { realPush, removeBins, spawn } from './hooks-harness.ts';
import {
  type Fixture,
  bareRemote,
  cleanFixtures,
  commit,
  fixture,
  realEnv,
  remoteRef,
  runtimeToken,
  sha,
} from './hooks-secrets-fixture.ts';

afterEach(async () => {
  await cleanFixtures();
  await removeBins();
});

const leak = (): string => `token = ${runtimeToken()}\n`;

/** The finding was caught: the push failed, said why, never printed the secret. */
function expectCaught(output: string, code: number): void {
  expect(code).not.toBe(0);
  expect(output).toContain('gitleaks found a secret in the commits being pushed');
  expect(output).toContain('ROTATE');
  expect(output).not.toMatch(/ghp_[0-9A-Za-z]{36}/);
}

describe.skipIf(Bun.which('gitleaks') === null)('with the real gitleaks', () => {
  describe('a commit that never ran pre-commit', () => {
    test('a token cherry-picked onto main is caught, and main on the remote does not move', async () => {
      const { repo, remote } = await fixture();
      await commit(repo, 'config.txt', leak());
      const side = await sha(repo);
      await repo.git('switch', '--quiet', 'main');
      await repo.git('cherry-pick', '--quiet', side);
      const before = await remoteRef(remote, 'main');

      const result = await realPush(repo, realEnv(), 'origin', 'main');

      expectCaught(result.output, result.code);
      expect(await remoteRef(remote, 'main')).toBe(before);
    });

    test('a new branch carrying the token is caught too, and the same push without it passes', async () => {
      const { repo, remote } = await fixture();
      await commit(repo, 'config.txt', leak());
      const refused = await realPush(repo, realEnv(), 'origin', 'feat');
      expectCaught(refused.output, refused.code);
      expect(await remoteRef(remote, 'feat')).toBeUndefined();

      await repo.git('reset', '--quiet', '--hard', 'HEAD~1');
      await commit(repo, 'config.txt', 'nothing secret here\n');
      expect((await realPush(repo, realEnv(), 'origin', 'feat')).code).toBe(0);
      expect(await remoteRef(remote, 'feat')).toBeDefined();
    });
  });

  describe('a merge commit', () => {
    /** `main` and `side` diverge; they are merged by hand, with `evil.txt` added when asked. */
    async function merged(fx: Fixture, evil: boolean): Promise<void> {
      const { repo } = fx;
      await repo.git('switch', '--quiet', '-c', 'side', 'main');
      await commit(repo, 'side.txt', 'side\n');
      await repo.git('switch', '--quiet', 'main');
      await commit(repo, 'main2.txt', 'main\n');
      await repo.git('merge', '--quiet', '--no-ff', '--no-commit', 'side');
      if (evil) await repo.write('evil.txt', leak());
      await repo.git('add', '-A');
      await repo.git('commit', '--quiet', '-m', 'merge side');
    }

    test('a token added INSIDE the merge is caught — `git log -p` shows a merge no diff', async () => {
      const fx = await fixture();
      await merged(fx, true);
      const before = await remoteRef(fx.remote, 'main');

      const result = await realPush(fx.repo, realEnv(), 'origin', 'main');

      expectCaught(result.output, result.code);
      expect(await remoteRef(fx.remote, 'main')).toBe(before);
    });

    test('a clean merge passes', async () => {
      const fx = await fixture();
      await merged(fx, false);

      const result = await realPush(fx.repo, realEnv(), 'origin', 'main');

      expect(result.code).toBe(0);
      expect(await remoteRef(fx.remote, 'main')).toBe(await sha(fx.repo, 'main'));
    });

    test('a clean merge whose parent holds an ALREADY PUBLISHED finding passes — no false positive', async () => {
      // ⚠️ Why `remerge` and not first-parent: first-parent diffs the merge against its first
      //   parent and re-reports everything the other side brought, published or not.
      const fx = await fixture();
      await fx.repo.git('switch', '--quiet', '-c', 'old', 'main');
      await commit(fx.repo, 'old.txt', leak());
      await fx.repo.git('push', '--quiet', 'origin', 'old');
      await fx.repo.git('switch', '--quiet', 'main');
      await commit(fx.repo, 'main2.txt', 'main\n');
      await fx.repo.git('merge', '--quiet', '--no-ff', '-m', 'merge old', 'old');

      const result = await realPush(fx.repo, realEnv(), 'origin', 'main');

      expect(result.code).toBe(0);
      expect(await remoteRef(fx.remote, 'main')).toBe(await sha(fx.repo, 'main'));
    });
  });

  describe('a remote whose address is not a plain name', () => {
    test('a path with a space: a token is caught — gitleaks split --log-opts there and its git failed', async () => {
      const { repo } = await fixture();
      const spaced = await bareRemote('hf spaced remote 3 ');
      await commit(repo, 'config.txt', leak());

      const result = await realPush(repo, realEnv(), spaced, 'feat');

      expectCaught(result.output, result.code);
      expect(await remoteRef(spaced, 'feat')).toBeUndefined();
    });

    test('and a clean push to that path goes through', async () => {
      const { repo } = await fixture();
      const spaced = await bareRemote('hf spaced remote 3 ');
      await commit(repo, 'notes.txt', 'nothing secret here\n');

      const result = await realPush(repo, realEnv(), spaced, 'feat');

      expect(result.code).toBe(0);
      expect(await remoteRef(spaced, 'feat')).toBeDefined();
    });
  });

  describe('a remote with no tracking refs here', () => {
    // 🔴 kit has 8 historical findings and landscape 2. A push by URL, or the first push to a new
    //   named remote, has no `refs/remotes/<it>/*`, so the scan covered the whole history and
    //   failed with "ROTATE it" on content published long ago. The remote says what it has.
    /** `main` carries an OLD finding that is already on the remote; `feat` adds a clean commit. */
    async function publishedHistory(): Promise<Fixture> {
      const fx = await fixture();
      await fx.repo.git('switch', '--quiet', 'main');
      await commit(fx.repo, 'old-finding.txt', leak());
      await fx.repo.git('push', '--quiet', 'origin', 'main');
      await fx.repo.git('switch', '--quiet', '-c', 'feat2');
      await commit(fx.repo, 'notes.txt', 'nothing secret here\n');
      return fx;
    }

    test('a push BY URL scans only what the remote lacks, so published history is not re-flagged', async () => {
      const fx = await publishedHistory();

      const result = await realPush(fx.repo, realEnv(), fx.remote, 'feat2');

      expect(result.code).toBe(0);
      expect(await remoteRef(fx.remote, 'feat2')).toBeDefined();
    });

    test('the first push to a NEW named remote does the same', async () => {
      const fx = await publishedHistory();
      await fx.repo.git('remote', 'add', 'second', fx.remote);

      const result = await realPush(fx.repo, realEnv(), 'second', 'feat2');

      expect(result.code).toBe(0);
    });

    test('an EMPTY remote scans everything, says how many commits, and names .gitleaksignore', async () => {
      const fx = await publishedHistory();
      const empty = await bareRemote();

      const result = await realPush(fx.repo, realEnv(), empty, 'feat2');

      expectCaught(result.output, result.code);
      expect(result.output).toMatch(/all \d+ reachable commit\(s\) are scanned/);
      expect(result.output).toContain('.gitleaksignore');
      expect(await remoteRef(empty, 'feat2')).toBeUndefined();
    });
  });

  describe('a stale remote-tracking ref', () => {
    /** A leaky commit pushed (hooks off) to `leaky`; the remote then deletes it; `origin/leaky` stays. */
    async function deletedOnTheRemote(): Promise<Fixture> {
      const fx = await fixture();
      await fx.repo.git('switch', '--quiet', '-c', 'leaky', 'main');
      await commit(fx.repo, 'config.txt', leak());
      await fx.repo.git('push', '--quiet', 'origin', 'leaky');
      await spawn(['git', '-C', fx.remote, 'branch', '-D', 'leaky'], fx.remote);
      await fx.repo.git('switch', '--quiet', 'main');
      return fx;
    }

    test('a fast-forward from the unpruned origin/leaky is caught — the remote no longer has it', async () => {
      // 🔴 `--not --remotes=origin` excluded those commits as "already published", and the secret
      //   was pushed again with exit 0. The remote's own ref list cannot be stale.
      const fx = await deletedOnTheRemote();
      // The premise: the tracking ref is still here, though the remote deleted the branch.
      const stale = await spawn(
        ['git', '-C', fx.repo.dir, 'rev-parse', 'origin/leaky'],
        fx.repo.dir,
      );
      expect(stale.code).toBe(0);
      await fx.repo.git('merge', '--quiet', '--ff-only', 'origin/leaky');

      const result = await realPush(fx.repo, realEnv(), 'origin', 'main');

      expectCaught(result.output, result.code);
      expect(await remoteRef(fx.remote, 'main')).not.toBe(await sha(fx.repo, 'main'));
    });

    test('the same push is fine while the remote still HAS the branch — it is already published', async () => {
      const fx = await fixture();
      await fx.repo.git('switch', '--quiet', '-c', 'leaky', 'main');
      await commit(fx.repo, 'config.txt', leak());
      await fx.repo.git('push', '--quiet', 'origin', 'leaky');
      await fx.repo.git('switch', '--quiet', 'main');
      await fx.repo.git('merge', '--quiet', '--ff-only', 'leaky');

      const result = await realPush(fx.repo, realEnv(), 'origin', 'main');

      expect(result.code).toBe(0);
    });
  });
});
