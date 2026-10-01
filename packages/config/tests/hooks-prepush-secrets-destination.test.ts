/**
 * The push scan asks only the destination git is pushing to.
 *
 * 🔴 MEASURED 2026-10-01. `knownRemoteTips` tried the push URL, and on any failure — including
 *   a stripped transport environment or a 20s timeout — fell through to `git ls-remote <name>`.
 *   That name uses the FETCH url. When `remote.<name>.pushurl` differs from `url`, the fetch
 *   side can advertise a secret commit the destination has never had; those tips were excluded
 *   and the push published the secret with exit 0. `gitAt` also dropped every `GIT_*`, including
 *   `GIT_SSH_COMMAND` and the `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_COUNT` block git 2.47.3 uses
 *   to hand `-c` to a hook, so the real push URL failed closed-looking auth and the fallback fired.
 * ⛔ THE TOKEN IS BUILT AT RUNTIME. A literal in this file would be a finding of its own.
 */
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { type Scratch, removeBins } from './hooks-harness.ts';
import {
  ZERO,
  bareRemote,
  cleanFixtures,
  commit,
  fixture,
  realEnv,
  remoteRef,
  runtimeToken,
  sha,
} from './hooks-secrets-fixture.ts';

const extra: string[] = [];

afterEach(async () => {
  await cleanFixtures();
  await removeBins();
  for (const dir of extra.splice(0)) await rm(dir, { recursive: true, force: true });
});

const leak = (): string => `token = ${runtimeToken()}\n`;

function expectCaught(output: string, code: number): void {
  expect(code).not.toBe(0);
  expect(output).toContain('gitleaks found a secret in the commits being pushed');
  expect(output).toContain('ROTATE');
  expect(output).not.toMatch(/ghp_[0-9A-Za-z]{36}/);
}

/**
 * `origin`'s fetch URL is a bare repo that already has the secret commit. A second bare repo,
 * the push destination, has only the seed. Both are `file://`.
 */
async function fetchHoldsSecret(): Promise<{
  repo: Scratch;
  destUrl: string;
  secret: string;
}> {
  const { repo, remote } = await fixture();
  const fetchUrl = `file://${remote}`;
  await repo.git('remote', 'set-url', 'origin', fetchUrl);
  const dest = await bareRemote();
  const destUrl = `file://${dest}`;
  const seed = await sha(repo, 'main');
  await repo.git('push', '--quiet', destUrl, `${seed}:refs/heads/main`);
  await commit(repo, 'config.txt', leak());
  const secret = await sha(repo);
  await repo.git('push', '--quiet', fetchUrl, 'HEAD:refs/heads/feat');
  await repo.git('remote', 'set-url', '--push', 'origin', destUrl);
  expect(await remoteRef(remote, 'feat')).toBe(secret);
  expect(await remoteRef(dest, 'feat')).toBeUndefined();
  return { repo, destUrl, secret };
}

const pushFeat = (repo: Scratch, secret: string, url: string, env = realEnv()) =>
  repo.hook('pre-push', {
    env,
    args: ['origin', url],
    stdin: `refs/heads/feat ${secret} refs/heads/feat ${ZERO}\n`,
  });

describe.skipIf(Bun.which('gitleaks') === null)(
  'ask the push destination, never the fetch URL',
  () => {
    test('a secret the fetch remote already has is caught when the push destination lacks it', async () => {
      // 🔴 The URL the hook is handed only resolves with the config block git passes a hook.
      //   Stripped, `ls-remote` of it fails and the name fallback answers from the fetch remote.
      const { repo, destUrl, secret } = await fetchHoldsSecret();
      const asked = 'hf-push://destination';
      const result = await pushFeat(repo, secret, asked, {
        ...realEnv(),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${destUrl}/.insteadOf`,
        GIT_CONFIG_VALUE_0: asked,
        GIT_CONFIG_PARAMETERS: `'url.${destUrl}/.insteadOf'='${asked}'`,
      });

      expectCaught(result.output, result.code);
      expect(result.output).not.toContain('already on the remote');
      expect(result.output).not.toContain('could not be asked');
    });

    test('an unreachable push URL scans the full pushed history and still catches the secret', async () => {
      const { repo, secret } = await fetchHoldsSecret();
      const missing = `file://${join(tmpdir(), `hf-hooks-absent-${crypto.randomUUID()}`)}`;

      const result = await pushFeat(repo, secret, missing);

      expectCaught(result.output, result.code);
      expect(result.output).toContain(
        'the destination could not be asked, so the full pushed history was scanned',
      );
      expect(result.output).not.toContain('already on the remote');
    });
  },
);

describe('what ls-remote inherits', () => {
  test('GIT_SSH_COMMAND and a GIT_CONFIG_COUNT block reach the child, and the name is not asked', async () => {
    const { repo, remote } = await fixture();
    const destUrl = `file://${remote}`;
    const bin = await mkdtemp(join(tmpdir(), 'hf-hooks-git-'));
    extra.push(bin);
    const record = join(bin, 'ls-remote.env');
    const realGit = Bun.which('git') ?? 'git';
    await Bun.write(
      join(bin, 'git'),
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = ls-remote ]; then',
        '    {',
        `      printf '%s\\n' "ARGS=$*"`,
        `      printf '%s\\n' "GIT_SSH_COMMAND=\${GIT_SSH_COMMAND-}"`,
        `      printf '%s\\n' "GIT_SSH=\${GIT_SSH-}"`,
        `      printf '%s\\n' "GIT_CONFIG_COUNT=\${GIT_CONFIG_COUNT-}"`,
        `      printf '%s\\n' "GIT_CONFIG_KEY_0=\${GIT_CONFIG_KEY_0-}"`,
        `      printf '%s\\n' "GIT_CONFIG_VALUE_0=\${GIT_CONFIG_VALUE_0-}"`,
        `      printf '%s\\n' "GIT_CONFIG_KEY_1=\${GIT_CONFIG_KEY_1-}"`,
        `      printf '%s\\n' "GIT_CONFIG_VALUE_1=\${GIT_CONFIG_VALUE_1-}"`,
        `      printf '%s\\n' "GIT_CONFIG_PARAMETERS=\${GIT_CONFIG_PARAMETERS-}"`,
        `      printf '%s\\n' "GIT_TERMINAL_PROMPT=\${GIT_TERMINAL_PROMPT-}"`,
        `      if [ -n "\${GIT_DIR+x}" ]; then printf '%s\\n' "GIT_DIR=$GIT_DIR"; else printf '%s\\n' "GIT_DIR=<unset>"; fi`,
        '    } >> ' + `'${record}'`,
        '  fi',
        'done',
        `exec '${realGit}' "$@"`,
        '',
      ].join('\n'),
    );
    await chmod(join(bin, 'git'), 0o755);
    const tip = await sha(repo);

    await repo.hook('pre-push', {
      env: {
        ...realEnv(),
        PATH: `${bin}:${realEnv().PATH ?? ''}`,
        GIT_SSH_COMMAND: 'hf-ssh-marker',
        GIT_SSH: 'hf-ssh-binary',
        GIT_DIR: '/hook/should-not-leak/.git',
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'test.hooktransport',
        GIT_CONFIG_VALUE_0: 'kept',
        GIT_CONFIG_KEY_1: 'test.hookcount',
        GIT_CONFIG_VALUE_1: 'block',
        GIT_CONFIG_PARAMETERS: "'test.hooktransport'='kept'",
      },
      args: ['origin', destUrl],
      stdin: `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`,
    });

    const seen = await Bun.file(record).text();
    expect(seen).toContain(`ARGS=-C ${repo.dir} ls-remote ${destUrl}`);
    expect(seen).not.toContain('ls-remote origin');
    expect(seen).toContain('GIT_SSH_COMMAND=hf-ssh-marker');
    expect(seen).toContain('GIT_SSH=hf-ssh-binary');
    expect(seen).toContain('GIT_CONFIG_COUNT=2');
    expect(seen).toContain('GIT_CONFIG_KEY_0=test.hooktransport');
    expect(seen).toContain('GIT_CONFIG_VALUE_0=kept');
    expect(seen).toContain('GIT_CONFIG_KEY_1=test.hookcount');
    expect(seen).toContain('GIT_CONFIG_VALUE_1=block');
    expect(seen).toContain("GIT_CONFIG_PARAMETERS='test.hooktransport'='kept'");
    expect(seen).toContain('GIT_TERMINAL_PROMPT=0');
    expect(seen).toContain('GIT_DIR=<unset>');
  });
});
