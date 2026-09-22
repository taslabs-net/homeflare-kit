/**
 * ★ THE KIT PASSES ITS OWN CONFORMANCE CHECK. If it did not, the preset would be
 *   untested: a config this repo does not itself obey is a config nothing proves works.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { checkProject } from '../src/check.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;

describe('checkProject', () => {
  test('this repo conforms to the config it publishes', async () => {
    expect(await checkProject(repoRoot)).toEqual([]);
  });

  test('reports a project that does not extend the presets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-conf-'));
    try {
      await writeFile(join(dir, 'tsconfig.json'), '{ "compilerOptions": {} }');
      const problems = await checkProject(dir);

      expect(problems.join('\n')).toContain('does not extend');
      // Missing files are reported too — silence on an absent config would be the worst
      // outcome, since it reads as conformance.
      expect(problems.join('\n')).toContain('bunfig.toml');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reads a tsconfig that carries comments', async () => {
    // ⚠️ A tsconfig LEGITIMATELY has comments — that is where the reasoning for a strict
    //   flag lives. Bun's .json() rejects them, so the checker strips them first.
    const dir = await mkdtemp(join(tmpdir(), 'hf-conf-'));
    try {
      await writeFile(
        join(dir, 'tsconfig.json'),
        '{\n  // why this flag is on\n  "extends": "@homeflare/config/tsconfig.base.json"\n}',
      );

      expect((await checkProject(dir)).join('\n')).not.toContain('tsconfig.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('does not mistake // inside a string for a comment', async () => {
    // 🔴 Measured while writing this: a naive regex mangled
    //   "./node_modules/oxlint/..." and reported valid JSON as unparseable.
    const dir = await mkdtemp(join(tmpdir(), 'hf-conf-'));
    try {
      await writeFile(
        join(dir, '.oxlintrc.json'),
        '{ "$schema": "https://example.com/schema.json", "extends": ["@homeflare/config/oxlintrc.json"] }',
      );

      expect((await checkProject(dir)).join('\n')).not.toContain('.oxlintrc.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('extra oxfmt ignores are a merge, not drift', async () => {
    // ⛔ Identity comparison rewrote generated OpenAPI (measured 2026-09-16).
    const dir = await mkdtemp(join(tmpdir(), 'hf-oxfmt-'));
    try {
      const house = (await Bun.file(new URL('../oxfmtrc.json', import.meta.url)).json()) as {
        readonly ignorePatterns: readonly string[];
      };
      await writeFile(
        join(dir, '.oxfmtrc.json'),
        JSON.stringify({ ...house, ignorePatterns: [...house.ignorePatterns, 'src/generated/**'] }),
      );
      expect((await checkProject(dir)).join('\n')).not.toContain('.oxfmtrc.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
