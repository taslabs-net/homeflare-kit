/**
 * Repositories, remotes and a token for the pre-push secret-scan tests.
 *
 * ★ A REAL REMOTE, A REAL `git push`. What the scan promises is about what reaches the remote, so
 *   every fixture is a wired repository (the committed wrapper, the package linked as a consumer
 *   has it) pushing to a bare repository in a temp directory. Every directory made here is
 *   removed by `cleanFixtures`, which a suite calls from `afterEach`.
 * ⛔ THE TOKEN IS BUILT AT RUNTIME. A token-shaped literal in a test file would be flagged by the
 *   repository's own scan, and would teach the scan to be ignored.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, scratchRepo, spawn, wireHooks, withBun } from './hooks-harness.ts';

export const ZERO: string = '0'.repeat(40);

const cleanups: Array<() => Promise<void>> = [];

/** ⚠️ CALL THIS FROM `afterEach`. */
export async function cleanFixtures(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) await cleanup();
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A GitHub-personal-access-token-shaped string, assembled here so no file holds one. */
export function runtimeToken(): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(36)), (b) => ALNUM[b % 62]);
  return ['ghp', random.join('')].join('_');
}

/** A bare repository in a temp directory. The `prefix` may hold spaces. */
export async function bareRemote(prefix = 'hf-secrets-remote-'): Promise<string> {
  const remote = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(async () => await rm(remote, { recursive: true, force: true }));
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  return remote;
}

export type Fixture = { readonly repo: Scratch; readonly remote: string };

/** A wired repository with `main` pushed to a bare remote named `origin`, and `feat` checked out. */
export async function fixture(): Promise<Fixture> {
  const repo = await scratchRepo('hf-secrets-');
  cleanups.push(async () => await repo.remove());
  const remote = await bareRemote();
  await wireHooks(repo);
  await repo.write('package.json', JSON.stringify({ scripts: { check: 'echo CHECK-RAN' } }));
  await repo.git('add', '-A');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
  return { repo, remote };
}

export const sha = async (repo: Scratch, ref = 'HEAD'): Promise<string> =>
  (await repo.git('rev-parse', ref)).trim();

/** Commit `file` with hooks OFF — the harness's own git runs with `core.hooksPath=/dev/null`. */
export async function commit(repo: Scratch, file: string, text: string): Promise<string> {
  await repo.write(file, text);
  await repo.git('add', '--', file);
  await repo.git('commit', '--quiet', '-m', `add ${file}`);
  return await sha(repo);
}

/** The environment of a real hook: this machine's PATH with `bun` in front, real gitleaks. */
export const realEnv = (): Record<string, string | undefined> => ({
  ...ENV,
  PATH: withBun(process.env['PATH'] ?? ''),
});

/** Does the remote have a ref, and at what sha? */
export async function remoteRef(remote: string, ref: string): Promise<string | undefined> {
  const result = await spawn(
    ['git', '-C', remote, 'rev-parse', '--verify', '--quiet', ref],
    remote,
  );
  return result.code === 0 ? result.output.trim() : undefined;
}
