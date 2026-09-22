/**
 * The secrets-shaped trap: pnpm-workspace.yaml lists nested packages, the pending
 * changeset names the root. See src/changeset-workspace.ts.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  packagesNamedInChangeset,
  problemsFromPendingChangesets,
  workspacePackageNames,
} from '../src/changeset-workspace.ts';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-changeset-workspace-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('workspacePackageNames', () => {
  test('a repo with no workspace file is the root package', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'homeflare-app' }));

      expect(await workspacePackageNames(dir)).toEqual(['homeflare-app']);
    });
  });

  test('pnpm-workspace.yaml listing only nested packages hides the root', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'homeflare-secrets' }));
      await mkdir(join(dir, 'hfs'));
      await writeFile(join(dir, 'hfs/package.json'), JSON.stringify({ name: '@homeflare/hfs' }));
      await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - hfs\n');

      expect(await workspacePackageNames(dir)).toEqual(['@homeflare/hfs']);
    });
  });

  test('`.` in pnpm-workspace.yaml puts the root back in the workspace', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'homeflare-secrets' }));
      await writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");

      expect(await workspacePackageNames(dir)).toEqual(['homeflare-secrets']);
    });
  });
});

describe('problemsFromPendingChangesets', () => {
  test('reports a changeset that names a package the workspace file hid', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'homeflare-secrets' }));
      await mkdir(join(dir, 'hfs'));
      await writeFile(join(dir, 'hfs/package.json'), JSON.stringify({ name: '@homeflare/hfs' }));
      await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - hfs\n');
      await mkdir(join(dir, '.changeset'));
      await writeFile(
        join(dir, '.changeset/repository-hygiene.md'),
        "---\n'homeflare-secrets': patch\n---\n\nHygiene.\n",
      );

      const problems = await problemsFromPendingChangesets(dir);

      expect(problems.join('\n')).toContain('homeflare-secrets');
      expect(problems.join('\n')).toContain('not in the workspace');
    });
  });

  test('passes when the workspace includes the named root', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'homeflare-secrets' }));
      await writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
      await mkdir(join(dir, '.changeset'));
      await writeFile(
        join(dir, '.changeset/repository-hygiene.md'),
        "---\n'homeflare-secrets': patch\n---\n\nHygiene.\n",
      );

      expect(await problemsFromPendingChangesets(dir)).toEqual([]);
    });
  });
});

describe('packagesNamedInChangeset', () => {
  test('reads a quoted single-package frontmatter', () => {
    expect(packagesNamedInChangeset("---\n'homeflare-secrets': patch\n---\n\nHi.\n")).toEqual([
      'homeflare-secrets',
    ]);
  });
});
