/**
 * Exercises shouldRelease against a throwaway git repo — no live calls, no network.
 * See src/release.ts for the bug this prevents.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { shouldRelease, tagEvent, tagExists } from '../src/release.ts';

const pkg = { name: 'homeflare-app', version: '0.1.0' } as const;

/**
 * ⛔ DROP HUSKY'S GIT_DIR. Pre-push sets GIT_DIR to this checkout. `cwd`
 *   is not enough — git then inits/commits the real branch. Measured
 *   2026-09-18: verify during push authored `init` as test@example.com
 *   on cursor/alchemy-79 and CodeQL saw an empty tree.
 */
const gitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
};

const git = (args: readonly string[], cwd: string) =>
  Bun.spawnSync(['git', ...args], { cwd, env: gitEnv() });

async function initGitRepo(dir: string): Promise<void> {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'test'],
  ]) {
    git(args, dir);
  }
  await writeFile(join(dir, 'README.md'), 'placeholder\n');
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
}

async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-release-gate-'));
  try {
    await initGitRepo(dir);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('shouldRelease', () => {
  test('skips — the first hygiene merge case: no CHANGELOG.md at all', async () => {
    await withRepo(async (dir) => {
      const decision = await shouldRelease(dir, pkg);

      expect(decision.ok).toBe(false);
      expect(decision.reason).toContain('no "## 0.1.0" entry');
    });
  });

  test('skips when CHANGELOG.md exists but has no entry for this version', async () => {
    await withRepo(async (dir) => {
      await writeFile(join(dir, 'CHANGELOG.md'), '# homeflare-app\n\n## 0.0.0\n\nOld.\n');

      const decision = await shouldRelease(dir, pkg);

      expect(decision.ok).toBe(false);
    });
  });

  test('proceeds — the real Version Packages merge case: entry present, no tag yet', async () => {
    await withRepo(async (dir) => {
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        '# homeflare-app\n\n## 0.1.0\n\n### Minor Changes\n\n- First Changesets release.\n',
      );

      const decision = await shouldRelease(dir, pkg);

      expect(decision.ok).toBe(true);
    });
  });

  test('ignores husky GIT_DIR so a tagged decoy repo cannot skip a fresh checkout', async () => {
    await withRepo(async (decoy) => {
      git(['tag', `${pkg.name}@${pkg.version}`], decoy);
      const previous = process.env.GIT_DIR;
      process.env.GIT_DIR = `${decoy}/.git`;
      try {
        await withRepo(async (dir) => {
          await writeFile(
            join(dir, 'CHANGELOG.md'),
            '# homeflare-app\n\n## 0.1.0\n\n### Minor Changes\n\n- First Changesets release.\n',
          );
          expect((await shouldRelease(dir, pkg)).ok).toBe(true);
        });
      } finally {
        if (previous === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = previous;
      }
    });
  });

  test('skips — recreate-existing-release case: entry present AND tag already exists', async () => {
    await withRepo(async (dir) => {
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        '# homeflare-app\n\n## 0.1.0\n\n### Minor Changes\n\n- First Changesets release.\n',
      );
      git(['tag', `${pkg.name}@${pkg.version}`], dir);

      const decision = await shouldRelease(dir, pkg);

      expect(decision.ok).toBe(false);
      expect(decision.reason).toContain('already exists');
      expect(tagExists(dir, `${pkg.name}@${pkg.version}`)).toBe(true);
    });
  });

  test('a heading for a different version does not false-match via substring', async () => {
    // ⚠️ "## 0.1.0" must not match "## 0.1.0-rc.1" or "## 0.1.00" — the regex anchors
    //   the whole line, not just the prefix.
    await withRepo(async (dir) => {
      await writeFile(
        join(dir, 'CHANGELOG.md'),
        '# homeflare-app\n\n## 0.1.0-rc.1\n\nPre-release.\n\n## 0.1.00\n\nTypo.\n',
      );

      const decision = await shouldRelease(dir, pkg);

      expect(decision.ok).toBe(false);
    });
  });
});

describe('tagEvent', () => {
  test('writes the ndjson shape changesets/action needs to create a GitHub Release', () => {
    expect(tagEvent(pkg)).toEqual({
      type: 'git-tag',
      tag: 'homeflare-app@0.1.0',
      packageName: 'homeflare-app',
    });
  });
});
