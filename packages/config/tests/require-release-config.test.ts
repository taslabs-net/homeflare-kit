/**
 * Exercises problemsInReleaseConfig directly — the reason it is still worth
 * shipping now that every app package.json has a real "version".
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { problemsInReleaseConfig } from '../src/require-release-config.ts';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-require-release-config-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('problemsInReleaseConfig', () => {
  test('fails when version is missing', async () => {
    await withTempDir(async (dir) => {
      const pkgPath = join(dir, 'package.json');
      await writeFile(pkgPath, JSON.stringify({ name: 'no-version' }));

      const problems = await problemsInReleaseConfig({
        pkgPath,
        changesetConfigPath: join(dir, 'missing.json'),
      });

      expect(problems.join('\n')).toContain('has no "version"');
    });
  });

  test('fails when version is present but empty', async () => {
    await withTempDir(async (dir) => {
      const pkgPath = join(dir, 'package.json');
      await writeFile(pkgPath, JSON.stringify({ name: 'empty-version', version: '' }));

      const problems = await problemsInReleaseConfig({
        pkgPath,
        changesetConfigPath: join(dir, 'missing.json'),
      });

      expect(problems).not.toEqual([]);
    });
  });

  test('fails when private and privatePackages.version is not set — the other silent no-op', async () => {
    // 🔴 Measured 2026-09-16: this combination has a real version AND is otherwise
    //   correctly configured, and @changesets/cli still versions nothing.
    await withTempDir(async (dir) => {
      const pkgPath = join(dir, 'package.json');
      const changesetConfigPath = join(dir, 'changeset-config.json');
      await writeFile(
        pkgPath,
        JSON.stringify({ name: 'private-pkg', version: '0.1.0', private: true }),
      );
      await writeFile(changesetConfigPath, JSON.stringify({}));

      const problems = await problemsInReleaseConfig({ pkgPath, changesetConfigPath });

      expect(problems.join('\n')).toContain('privatePackages.version');
    });
  });

  test('passes when private and privatePackages.version is true', async () => {
    await withTempDir(async (dir) => {
      const pkgPath = join(dir, 'package.json');
      const changesetConfigPath = join(dir, 'changeset-config.json');
      await writeFile(
        pkgPath,
        JSON.stringify({ name: 'private-pkg', version: '0.1.0', private: true }),
      );
      await writeFile(
        changesetConfigPath,
        JSON.stringify({ privatePackages: { version: true, tag: false } }),
      );

      expect(await problemsInReleaseConfig({ pkgPath, changesetConfigPath })).toEqual([]);
    });
  });

  test('passes a public package without reading changeset config', async () => {
    await withTempDir(async (dir) => {
      const pkgPath = join(dir, 'package.json');
      await writeFile(pkgPath, JSON.stringify({ name: 'public-pkg', version: '1.0.0' }));

      expect(
        await problemsInReleaseConfig({
          pkgPath,
          changesetConfigPath: join(dir, 'does-not-exist.json'),
        }),
      ).toEqual([]);
    });
  });
});
