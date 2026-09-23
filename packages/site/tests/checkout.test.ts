/**
 * The loader refuses a site file that is not committed, unmodified, on `main` —
 * unless `siteDev` says otherwise. Uses a real throwaway git repository.
 */
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

async function git(dir: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn([...GIT, '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe', env });
  const stdout = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(' ')}: ${await new Response(proc.stderr).text()}`);
  }
  return stdout;
}

/**
 * Put the committed bytes of `name` back, by writing them.
 *
 * 🔴 NOT `git checkout -- <name>`, AND THAT WAS THE FLAKE. Measured 2026-09-23: 10 of 60 runs
 *   failed under CPU load, always on the `loaded` after the skip-worktree edit. git decides
 *   whether a file needs rewriting from the stat data it cached, and compares mtimes to the
 *   whole SECOND (git is built without USE_NSEC). That edit keeps the size
 *   (`example.com` → `example.net`) and the inode (writeFile truncates in place); when it
 *   lands in the same second as the cached stat, while the index file itself was written a
 *   second LATER — so the entry no longer counts as "racily clean" — git takes the file for
 *   unchanged and `checkout` skips it without a word. Seen in `git ls-files --debug`: entry
 *   mtime 1790176665.208, file mtime 1790176665.991, index 1790176666.145. The loader under
 *   test was right throughout (it compares blob hashes, not stat); only this cleanup trusted
 *   stat.
 */
async function restore(dir: string, name: string): Promise<void> {
  await writeFile(join(dir, name), await git(dir, 'show', `HEAD:${name}`));
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
    await restore(repo, 'live.site.json');
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

  test('clean on main, but an HF_SITE_* override: refused without siteDev', async () => {
    // ⛔ An override is an unreviewed value, like an uncommitted edit.
    expect(await codeFor(false)).toBe('loaded');
    const error = await loadSite({
      env: { HF_SITE_FILE: file, HF_SITE_APEX: 'example.net' },
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SiteError);
    expect((error as SiteError).code).toBe('override');
    expect((error as SiteError).issues).toEqual(['HF_SITE_APEX']);
  });

  test('skip-worktree hides an edit from git status: still refused', async () => {
    // ⚠️ Measured 2026-09-21: status printed nothing and a status-only guard loaded this.
    await git(repo, 'update-index', '--skip-worktree', 'live.site.json');
    await writeFile(file, JSON.stringify({ ...example(), apex: 'example.net' }));
    expect(await codeFor(false)).toContain('uncommitted changes');
    await git(repo, 'update-index', '--no-skip-worktree', 'live.site.json');
    await restore(repo, 'live.site.json');
    expect(await codeFor(false)).toBe('loaded');
  });

  test('a committed symlink to a file outside the repo: refused', async () => {
    // ⚠️ git tracks the link's target path, not the bytes behind it.
    const outside = await mkdtemp(join(tmpdir(), 'hf-site-outside-'));
    const target = join(outside, 'target.site.json');
    await writeFile(target, JSON.stringify(example()));
    const link = join(repo, 'linked.site.json');
    await symlink(target, link);
    await git(repo, 'add', 'linked.site.json');
    await git(repo, 'commit', '--quiet', '-m', 'link');
    try {
      expect(checkoutProblem(await readCheckout(link), 'main')).toContain('not inside');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('an exported GIT_DIR is not the file’s repository', async () => {
    // ⚠️ Git exports GIT_DIR to hooks, and it beats `git -C`. Without the loader dropping
    //   it, a file outside any repo would be judged by THIS throwaway repo: "on main".
    const outside = await mkdtemp(join(tmpdir(), 'hf-site-nogit-'));
    const stray = join(outside, 'stray.site.json');
    await writeFile(stray, JSON.stringify(example()));
    const saved = process.env['GIT_DIR'];
    process.env['GIT_DIR'] = join(repo, '.git');
    try {
      expect(await readCheckout(stray)).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env['GIT_DIR'];
      else process.env['GIT_DIR'] = saved;
      await rm(outside, { recursive: true, force: true });
    }
  });
});
