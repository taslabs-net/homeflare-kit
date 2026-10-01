/**
 * pre-push scans the commits it carries for secrets (push-secrets.ts).
 *
 * 🔴 git RUNS NO pre-commit FOR A CHERRY-PICK, MERGE, REBASE OR `am`. Measured by the red team on
 *   2026-10-01: a GitHub-token-shaped string committed with hooks off on a side branch,
 *   cherry-picked onto `main`, and pushed, went to the remote with exit 0. pre-commit never saw
 *   it; the push is the one door every commit goes through.
 * ★ TWO KINDS OF TEST, BECAUSE CI HAS NO gitleaks. A shim records the arguments it was called
 *   with, so what is scanned (which commits, which remote) is pinned everywhere. The tests that
 *   need the real engine to FIND something skip when the binary is absent, and run on every
 *   machine that has one — CT100 and a Mac with Homebrew both do.
 * ⛔ THE FIXTURE IS BUILT AT RUNTIME. A token-shaped literal in this file would be flagged by
 *   the repository's own scan, and would teach the scan to be ignored.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV,
  type Scratch,
  gitleaksCalls,
  pathWith,
  realPush,
  removeBins,
  scratchRepo,
  spawn,
  wireHooks,
  withBun,
} from './hooks-harness.ts';

const ZERO = '0'.repeat(40);

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await removeBins();
});

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A GitHub-personal-access-token-shaped string, assembled here so no file holds one. */
function runtimeToken(): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(36)), (b) => ALNUM[b % 62]);
  return ['ghp', random.join('')].join('_');
}

type Fixture = { repo: Scratch; remote: string };

/** A repository with `main` pushed to a bare remote named `origin`, and `feat` checked out. */
async function fixture(): Promise<Fixture> {
  const repo = await scratchRepo('hf-secrets-');
  const remote = await mkdtemp(join(tmpdir(), 'hf-secrets-remote-'));
  cleanups.push(async () => {
    await repo.remove();
    await rm(remote, { recursive: true, force: true });
  });
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await wireHooks(repo);
  await repo.write('package.json', JSON.stringify({ scripts: { check: 'echo CHECK-RAN' } }));
  await repo.git('add', '-A');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
  return { repo, remote };
}

const sha = async (repo: Scratch, ref = 'HEAD'): Promise<string> =>
  (await repo.git('rev-parse', ref)).trim();

async function commit(repo: Scratch, file: string, text: string): Promise<string> {
  await repo.write(file, text);
  await repo.git('add', '--', file);
  await repo.git('commit', '--quiet', '-m', `add ${file}`);
  return await sha(repo);
}

describe('what is scanned', () => {
  test('the commits this push adds: the tip, not on any ref of the remote', async () => {
    const { repo } = await fixture();
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
    expect(calls[0]).toContain(`--log-opts=${tip} --not --remotes=origin`);
  });

  test('every pushed ref goes into ONE scan, and a deletion adds nothing to it', async () => {
    const { repo } = await fixture();
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
    expect(calls[0]).toContain(`--log-opts=${one} ${two} --not --remotes=origin`);
  });

  test('a manual run, with nothing on stdin, scans HEAD', async () => {
    const { repo } = await fixture();
    const tip = await commit(repo, 'a.txt', 'a\n');
    const path = await pathWith(0);

    await repo.hook('pre-push', { env: { ...ENV, PATH: path }, args: ['origin', 'url'] });

    expect((await gitleaksCalls(path))[0]).toContain(`--log-opts=${tip} --not`);
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

describe.skipIf(Bun.which('gitleaks') === null)('with the real gitleaks', () => {
  /** `feat` carries a commit made with hooks OFF; the token is cherry-picked onto `main`. */
  async function cherryPicked(): Promise<Fixture & { env: Record<string, string | undefined> }> {
    const { repo, remote } = await fixture();
    // The repo's own git helper runs with core.hooksPath=/dev/null: this commit is unscanned.
    await commit(repo, 'config.txt', `token = ${runtimeToken()}\n`);
    const side = await sha(repo);
    await repo.git('switch', '--quiet', 'main');
    await repo.git('cherry-pick', '--quiet', side);
    return { repo, remote, env: { ...ENV, PATH: withBun(process.env['PATH'] ?? '') } };
  }

  async function remoteHas(remote: string, ref: string): Promise<boolean> {
    return (
      (await spawn(['git', '-C', remote, 'rev-parse', '--verify', '--quiet', ref], remote)).code ===
      0
    );
  }

  test('a token cherry-picked onto main is caught on the push, never reaching the remote', async () => {
    const { repo, remote, env } = await cherryPicked();
    const before = (await spawn(['git', '-C', remote, 'rev-parse', 'main'], remote)).output;

    const result = await realPush(repo, env, 'origin', 'main');

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('gitleaks found a secret in the commits being pushed');
    expect(result.output).toContain('ROTATE');
    // `--redact`: the finding names the rule and the place, never the secret.
    expect(result.output).not.toMatch(/ghp_[0-9A-Za-z]{36}/);
    expect((await spawn(['git', '-C', remote, 'rev-parse', 'main'], remote)).output).toBe(before);
  });

  test('a new branch carrying the token is caught too', async () => {
    const { repo, remote } = await fixture();
    await commit(repo, 'config.txt', `token = ${runtimeToken()}\n`);

    const result = await realPush(
      repo,
      { ...ENV, PATH: withBun(process.env['PATH'] ?? '') },
      'origin',
      'feat',
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('ROTATE');
    expect(await remoteHas(remote, 'refs/heads/feat')).toBe(false);
  });

  test('the same push without the token goes through', async () => {
    const { repo, remote } = await fixture();
    await commit(repo, 'config.txt', 'nothing secret here\n');

    const result = await realPush(
      repo,
      { ...ENV, PATH: withBun(process.env['PATH'] ?? '') },
      'origin',
      'feat',
    );

    expect(result.code).toBe(0);
    expect(await remoteHas(remote, 'refs/heads/feat')).toBe(true);
  });
});
