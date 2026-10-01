/**
 * pre-push scans the commits it carries for secrets (push-secrets.ts) — what it scans, what it
 * does about a finding, and every way it refuses to take "no leaks found" on trust.
 *
 * 🔴 git RUNS NO pre-commit FOR A CHERRY-PICK, MERGE, REBASE OR `am`. Measured by the red team on
 *   2026-10-01: a GitHub-token-shaped string committed with hooks off on a side branch,
 *   cherry-picked onto `main`, and pushed, went to the remote with exit 0.
 * ★ A SHIM THAT RECORDS ITS ARGUMENTS, because CI has no gitleaks: what is scanned (which
 *   commits, excluding what) is pinned everywhere. The tests that need the real engine to FIND
 *   something are in hooks-prepush-secrets-real.test.ts, and skip where it is absent.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { ENV, gitleaksCalls, pathWith, removeBins } from './hooks-harness.ts';
import { ZERO, bareRemote, cleanFixtures, commit, fixture, sha } from './hooks-secrets-fixture.ts';

afterEach(async () => {
  await cleanFixtures();
  await removeBins();
});

describe('what is scanned', () => {
  test('the commits this push adds: the tip, excluding what the REMOTE says it has', async () => {
    const { repo } = await fixture();
    const seed = await sha(repo, 'main');
    const tip = await commit(repo, 'a.txt', 'a\n');
    const path = await pathWith(0);

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: path },
      args: ['origin', 'url'],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain('gitleaks found no secret in the commits being pushed');
    const calls = await gitleaksCalls(path);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('git --redact --no-banner');
    // 🔴 `remerge`, so a merge's own changes are scanned; `--not <hash>`, not `--remotes=`.
    expect(calls[0]).toContain(`--log-opts=--diff-merges=remerge ${tip} --not ${seed}`);
    expect(calls[0]).not.toContain('--remotes');
  });

  test('a push by URL, where no tracking ref exists, still excludes what the remote has', async () => {
    // 🔴 The remote's name here IS its URL: there is no `refs/remotes/<it>/*`. Measured: the scan
    //   then covered the whole history, and failed on findings that were published long ago.
    const { repo, remote } = await fixture();
    const seed = await sha(repo, 'main');
    const tip = await commit(repo, 'a.txt', 'a\n');
    const path = await pathWith(0);

    await repo.hook('pre-push', {
      env: { ...ENV, PATH: path },
      args: [remote, remote],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect((await gitleaksCalls(path))[0]).toContain(`${tip} --not ${seed}`);
  });

  test('every pushed ref goes into ONE scan, and a deletion adds nothing to it', async () => {
    const { repo } = await fixture();
    const seed = await sha(repo, 'main');
    const one = await commit(repo, 'a.txt', 'a\n');
    const two = await commit(repo, 'b.txt', 'b\n');
    const path = await pathWith(0);

    await repo.hook('pre-push', {
      env: { ...ENV, PATH: path },
      args: ['origin', 'url'],
      stdin:
        `refs/heads/one ${one} refs/heads/one ${ZERO}\n` +
        `refs/heads/two ${two} refs/heads/two ${ZERO}\n` +
        `(delete) ${ZERO} refs/heads/old ${one}\n`,
    });

    const calls = await gitleaksCalls(path);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`--log-opts=--diff-merges=remerge ${one} ${two} --not ${seed}`);
  });

  test('a manual run, with nothing on stdin, scans HEAD', async () => {
    const { repo } = await fixture();
    const tip = await commit(repo, 'a.txt', 'a\n');
    const path = await pathWith(0);

    await repo.hook('pre-push', { env: { ...ENV, PATH: path }, args: ['origin', 'url'] });

    expect((await gitleaksCalls(path))[0]).toContain(`${tip} --not`);
  });

  test('a push that only deletes scans nothing, and needs no gitleaks to say so', async () => {
    const { repo } = await fixture();
    const path = await pathWith('absent');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: path },
      args: ['origin', 'url'],
      stdin: `(delete) ${ZERO} refs/heads/old ${await sha(repo)}\n`,
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain('only deletes');
  });

  test('a commit the remote already has is nothing to scan — and needs no gitleaks either', async () => {
    const { repo } = await fixture();
    const seed = await sha(repo, 'main');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith('absent') },
      args: ['origin', 'url'],
      stdin: `refs/tags/v0 ${seed} refs/tags/v0 ${ZERO}\n`,
    });

    expect(result.output).toContain('already on the remote');
    expect(result.output).not.toContain('NOT scanned');
  });
});

describe('when nothing of the push is known to be on the remote', () => {
  // 🔴 A remote that cannot be asked, or has none of these commits (a new, empty one), widens to
  //   the whole history. kit has 8 historical findings and landscape 2, so that scan can fail on
  //   old, already-reviewed content — and a bare "ROTATE it" would then be a lie. It says how
  //   many commits it is reading and where a reviewed false positive is recorded.
  test('an unaskable remote: says it is scanning everything, with the count and .gitleaksignore', async () => {
    const { repo } = await fixture();
    const tip = await commit(repo, 'a.txt', 'a\n');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith(0) },
      args: ['nowhere', 'nowhere-either'],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect(result.output).toContain('it could not be asked');
    expect(result.output).toContain('all 2 reachable commit(s) are scanned');
    expect(result.output).toContain('.gitleaksignore');
  });

  test('an empty remote: the whole history IS new, and a finding there names .gitleaksignore', async () => {
    const { repo } = await fixture();
    const empty = await bareRemote();
    const tip = await commit(repo, 'a.txt', 'a\n');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith(1) },
      args: [empty, empty],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('it has none of these commits here');
    expect(result.output).toContain('ROTATE');
    expect(result.output).toContain('record it in .gitleaksignore');
  });
});

describe('what it does about a finding, or no scanner', () => {
  test('a finding fails the push: remove it, rotate it, and no lane runs', async () => {
    const { repo } = await fixture();
    const tip = await commit(repo, 'a.txt', 'a\n');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith(1) },
      args: ['origin', 'url'],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('gitleaks found a secret in the commits being pushed');
    expect(result.output).toContain('ROTATE');
    expect(result.output).not.toContain('record it in .gitleaksignore');
    expect(result.output).not.toContain('CHECK-RAN');
    expect(result.output).not.toContain('--no-verify');
  });

  test('fails CLOSED when gitleaks is not installed — the pushed commits were NOT scanned', async () => {
    const { repo } = await fixture();
    const tip = await commit(repo, 'a.txt', 'a\n');

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith('absent') },
      args: ['origin', 'url'],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${ZERO}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('NOT scanned');
    expect(result.output).toContain('brew install gitleaks');
  });
});
