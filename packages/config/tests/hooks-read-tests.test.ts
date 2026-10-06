/**
 * pre-push selects tests that read a changed file, not only tests that import one.
 *
 * 🔴 MEASURED 2026-10-06, bun 1.4.0: `bun test --changed=<base> extra.test.ts` still
 *   prints "no test files are affected" and runs nothing. A docs file or a vendored
 *   `.py` is not an import, so the hook has to add the test that names it.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, pathWith, removeBins, scratchRepo, spawn } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);
const ADDED = 'added 1 extra test file(s) — 1 changed non-module path(s) named in a test';

const repo: Scratch = await scratchRepo('hf-read-tests-');
const remote = await mkdtemp(join(tmpdir(), 'hf-read-remote-')).catch(async (error: unknown) => {
  await repo.remove();
  throw error;
});
afterAll(async () => {
  await removeBins();
  await repo.remove();
  await rm(remote, { recursive: true, force: true });
});
const clean = { ...ENV, PATH: await pathWith(0) };

async function sha(ref = 'HEAD'): Promise<string> {
  return (await repo.git('rev-parse', ref)).trim();
}

async function commit(path: string, text: string): Promise<string> {
  await repo.write(path, text);
  await repo.git('add', '--', path);
  await repo.git('commit', '--quiet', '-m', `edit ${path}`);
  return await sha();
}

const push = (local: string, remoteSha: string) =>
  repo.hook('pre-push', {
    args: ['origin', remote],
    stdin: `refs/heads/feat ${local} refs/heads/feat ${remoteSha}\n`,
    env: clean,
  });

beforeAll(async () => {
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await mkdir(join(repo.dir, 'src/hf-rag-vendor/ingest'), { recursive: true });
  await mkdir(join(repo.dir, 'docs'), { recursive: true });
  await mkdir(join(repo.dir, 'tests'), { recursive: true });
  await repo.write(
    'package.json',
    JSON.stringify({ name: 'probe', private: true, scripts: { check: 'bun test' } }),
  );
  await repo.write('.gitignore', 'node_modules\n');
  await repo.write('src/mod.ts', 'export const value = 1;\n');
  await repo.write(
    'src/mod.test.ts',
    [
      "import { expect, test } from 'bun:test';",
      "import { value } from './mod.ts';",
      "test('mod', () => {",
      "  console.log('MOD-TEST-RAN');",
      '  expect(value).toBeGreaterThan(0);',
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('docs/unit-gaps.md', 'seed\n');
  await repo.write(
    'tests/gaps.test.ts',
    [
      "import { readFileSync } from 'node:fs';",
      "import { expect, test } from 'bun:test';",
      '// src/mod.ts is an import, not a file this test reads.',
      "test('gaps', () => {",
      "  const text = readFileSync('docs/unit-gaps.md', 'utf8');",
      "  console.log('GAPS-TEST-RAN');",
      "  expect(text).toContain('measured');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('src/hf-rag-vendor/ingest/hf-docs-mcp.py', 'py\n');
  await repo.write('src/hf-rag-vendor/SHA256SUMS', 'pin\n');
  await repo.write(
    'tests/vendor.test.ts',
    [
      "import { readFileSync } from 'node:fs';",
      "import { expect, test } from 'bun:test';",
      "const tree = 'src/hf-rag-vendor/';",
      "test('vendor pin', () => {",
      "  const text = readFileSync(tree + 'SHA256SUMS', 'utf8');",
      "  console.log('VENDOR-TEST-RAN');",
      "  expect(text).toContain('pin');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('docs/zz-quiet-note.md', 'quiet\n');
  await repo.git('add', '.');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
});

test('a docs edit read by a test selects that test and names the count', async () => {
  const tip = await commit('docs/unit-gaps.md', 'fleet measured\n');
  const result = await push(tip, ZERO);

  expect(result.code).toBe(0);
  expect(result.output).toContain('GAPS-TEST-RAN');
  expect(result.output).not.toContain('VENDOR-TEST-RAN');
  expect(result.output).not.toContain('MOD-TEST-RAN');
  expect(result.output).toContain(ADDED);
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('a vendored .py edit selects the test that names its directory', async () => {
  const before = await sha();
  const tip = await commit('src/hf-rag-vendor/ingest/hf-docs-mcp.py', 'py changed\n');
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  expect(result.output).toContain('VENDOR-TEST-RAN');
  expect(result.output).not.toContain('GAPS-TEST-RAN');
  expect(result.output).not.toContain('MOD-TEST-RAN');
  expect(result.output).toContain(ADDED);
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('an unrelated markdown file selects nothing extra', async () => {
  const before = await sha();
  const tip = await commit('docs/zz-quiet-note.md', 'quiet edited\n');
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  expect(result.output).toContain('no test files are affected');
  expect(result.output).not.toContain('GAPS-TEST-RAN');
  expect(result.output).not.toContain('VENDOR-TEST-RAN');
  expect(result.output).not.toContain('MOD-TEST-RAN');
  expect(result.output).not.toContain('extra test file');
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('a module edit stays on the import graph', async () => {
  const before = await sha();
  const tip = await commit('src/mod.ts', 'export const value = 2;\n');
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  expect(result.output).toContain('MOD-TEST-RAN');
  expect(result.output).not.toContain('GAPS-TEST-RAN');
  expect(result.output).not.toContain('VENDOR-TEST-RAN');
  expect(result.output).not.toContain('extra test file');
});
