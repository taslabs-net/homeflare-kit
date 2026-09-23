/**
 * `resolveOxfmtConfig` in isolation — a plain temp directory, no git, no oxfmt binary.
 * The end-to-end proof that the resolved path actually changes oxfmt's behaviour lives in
 * hooks-precommit-config.test.ts, against the real pinned binary.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { resolveOxfmtConfig } from '../src/hooks/oxfmt-config.ts';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-oxfmt-config-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('resolveOxfmtConfig', () => {
  test('no config file at all: none — bare oxfmt keeps using its defaults', async () => {
    await withTempDir(async (dir) => {
      expect(await resolveOxfmtConfig(dir)).toEqual({ kind: 'none' });
    });
  });

  test('.oxfmtrc.json present: auto — bare oxfmt already finds it, nothing to pass', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.oxfmtrc.json'), '{}');
      expect(await resolveOxfmtConfig(dir)).toEqual({ kind: 'auto' });
    });
  });

  test('.oxfmtrc.jsonc present: also auto-discovered by oxfmt', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.oxfmtrc.jsonc'), '{}');
      expect(await resolveOxfmtConfig(dir)).toEqual({ kind: 'auto' });
    });
  });

  test('BUG 2 shape: only .oxfmtrc.mjs — explicit, so the hook can pass --config itself', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.oxfmtrc.mjs'), 'export default {};');
      expect(await resolveOxfmtConfig(dir)).toEqual({
        kind: 'explicit',
        path: join(dir, '.oxfmtrc.mjs'),
      });
    });
  });

  test('.oxfmtrc.json wins over a stray .oxfmtrc.mjs — matches what bare oxfmt would find', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.oxfmtrc.json'), '{}');
      await writeFile(join(dir, '.oxfmtrc.mjs'), 'export default {};');
      expect(await resolveOxfmtConfig(dir)).toEqual({ kind: 'auto' });
    });
  });

  test('two configs oxfmt cannot auto-discover: ambiguous, names both', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.oxfmtrc.mjs'), 'export default {};');
      await writeFile(join(dir, '.oxfmtrc.cjs'), 'module.exports = {};');
      expect(await resolveOxfmtConfig(dir)).toEqual({
        kind: 'ambiguous',
        files: ['.oxfmtrc.mjs', '.oxfmtrc.cjs'],
      });
    });
  });
});
