/**
 * The loader refuses a site file that is not committed, unmodified, on `main` —
 * unless `siteDev` says otherwise. Uses a real throwaway git repository.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { SiteError } from '../src/index.ts';
import { checkoutProblem, loadSite, readCheckout } from '../src/load.ts';
import { example } from './fixture.ts';

// ⚠️ Pin every setting a developer's global git config could change: identity, signing
//   (a gpg prompt hangs the test) and hooks.
const GIT = [
  'git',
  '-c',
  'user.name=site-test',
  '-c',
  'user.email=site-test@example.com',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

// ⛔ And drop GIT_*: under the pre-push hook git exports GIT_DIR, and `git init`/`commit`
//   here would then write into THIS repository instead of the throwaway one.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

async function git(dir: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn([...GIT, '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe', env });
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(' ')}: ${await new Response(proc.stderr).text()}`);
  }
}

const repo = await mkdtemp(join(tmpdir(), 'hf-site-checkout-'));
const file = join(repo, 'live.site.json');
afterAll(() => rm(repo, { recursive: true, force: true }));

async function codeFor(siteDev: boolean): Promise<string> {
  try {
    await loadSite({ env: { HF_SITE_FILE: file }, siteDev });
    return 'loaded';
  } catch (error) {
    if (error instanceof SiteError) return `${error.code}: ${error.message}`;
    throw error;
  }
}

describe('checkout guard (sequential: each step changes the repo)', () => {
  test('outside any git checkout: refused', async () => {
    await writeFile(file, JSON.stringify(example()));
    expect(await readCheckout(file)).toBeUndefined();
    expect(await codeFor(false)).toContain('checkout: ');
    expect(await codeFor(false)).toContain('not inside a git checkout');
  });

  test('siteDev loads it anyway', async () => {
    expect(await codeFor(true)).toBe('loaded');
  });

  test('untracked on main: refused', async () => {
    await git(repo, 'init', '--quiet', '--initial-branch=main');
    expect(await codeFor(false)).toContain('not committed');
  });

  test('committed on main: loads', async () => {
    await git(repo, 'add', 'live.site.json');
    await git(repo, 'commit', '--quiet', '-m', 'site');
    expect(await readCheckout(file)).toEqual({ branch: 'main', tracked: true, dirty: false });
    expect(await codeFor(false)).toBe('loaded');
  });

  test('another file dirty: still loads — dirtiness is the site file’s own', async () => {
    await writeFile(join(repo, 'notes.md'), 'unrelated work in progress');
    expect(await codeFor(false)).toBe('loaded');
  });

  test('the site file modified: refused', async () => {
    await writeFile(file, `${JSON.stringify(example(), null, 2)}\n`);
    expect(await codeFor(false)).toContain('uncommitted changes');
    await git(repo, 'checkout', '--quiet', '--', 'live.site.json');
  });

  test('a feature branch: refused, naming it', async () => {
    await git(repo, 'switch', '--quiet', '-c', 'feature');
    expect(await codeFor(false)).toContain('"feature", not "main"');
  });

  test('a detached HEAD: refused', async () => {
    await git(repo, 'switch', '--quiet', '--detach', 'main');
    expect(await codeFor(false)).toContain('detached HEAD');
  });

  test('an ignored file: refused, even though git status is clean', async () => {
    // ⚠️ `git status --porcelain` prints nothing for an ignored file, so a guard reading
    //   only status would call a never-reviewed file clean.
    await git(repo, 'switch', '--quiet', 'main');
    const ignored = join(repo, 'private.site.json');
    await writeFile(join(repo, '.gitignore'), 'private.site.json\n');
    await writeFile(ignored, JSON.stringify(example()));
    expect(checkoutProblem(await readCheckout(ignored), 'main')).toContain('not committed');
  });
});
