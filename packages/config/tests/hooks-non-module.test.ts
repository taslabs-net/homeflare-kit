/**
 * A non-module push runs the suite in full. A module push stays on `--changed`.
 *
 * ★ THE HOOK, A REAL REMOTE, AND A REAL `bun test` — not the predicate. Each case is
 *   one commit on top of what the remote has, so the markers say which tests ran.
 * 🔴 MEASURED 2026-10-06: an edit of a doc or a vendored `.py` reported "no test
 *   files are affected". An add of an unnamed path already widened; these are edits.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, pathWith, removeBins, scratchRepo, spawn } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);
const DOCS = ['docs/unit-gaps.md', 'docs/unit-gaps-notes.md'] as const;
const VENDOR = 'src/hf-rag-vendor/ingest/hf-docs-mcp.py';

const PROBE = {
  name: 'probe',
  private: true,
  scripts: { check: 'echo LINT-LANE-RAN && bun test' },
};

function testFile(name: string): string {
  return [
    "import { expect, test } from 'bun:test';",
    `import { value } from './${name}.ts';`,
    `test('${name}', () => {`,
    `  console.log('${name.toUpperCase()}-TEST-RAN');`,
    '  expect(value).toBeGreaterThan(0);',
    '});',
    '',
  ].join('\n');
}

const repo: Scratch = await scratchRepo('hf-non-module-');
const remote = await mkdtemp(join(tmpdir(), 'hf-non-module-remote-'));
const clean = { ...ENV, PATH: await pathWith(0) };

async function sha(ref = 'HEAD'): Promise<string> {
  return (await repo.git('rev-parse', ref)).trim();
}

async function commit(files: Readonly<Record<string, string>>): Promise<string> {
  for (const [path, text] of Object.entries(files)) await repo.write(path, text);
  await repo.git('add', '--', ...Object.keys(files));
  await repo.git('commit', '--quiet', '-m', 'edit');
  return await sha();
}

/** Push `tip`, measured from `base` (zero sha: a new branch). Returns the hook output. */
async function push(tip: string, base: string): Promise<string> {
  const result = await repo.hook('pre-push', {
    args: ['origin', remote],
    stdin: `refs/heads/feat ${tip} refs/heads/feat ${base}\n`,
    env: clean,
  });
  expect(result.code).toBe(0);
  return result.output;
}

function expectFull(output: string, count: number, hidden: readonly string[]): void {
  expect(output).toContain(`${String(count)} non-module file(s) — tests in full`);
  expect(output).toContain('(IN FULL)');
  expect(output).toContain('A-TEST-RAN');
  expect(output).toContain('B-TEST-RAN');
  for (const path of hidden) expect(output).not.toContain(path);
}

beforeAll(async () => {
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await mkdir(join(repo.dir, 'docs'), { recursive: true });
  await mkdir(join(repo.dir, 'src/hf-rag-vendor/ingest'), { recursive: true });
  await repo.write('package.json', JSON.stringify(PROBE, null, 2));
  await repo.write('.gitignore', 'node_modules\n');
  for (const name of ['a', 'b']) {
    await repo.write(`${name}.ts`, 'export const value = 1;\n');
    await repo.write(`${name}.test.ts`, testFile(name));
  }
  await repo.write(DOCS[0], '# gaps\n');
  await repo.write(DOCS[1], '# notes\n');
  await repo.write(VENDOR, '# vendor\n');
  await repo.git('add', '.');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
});

afterAll(async () => {
  await removeBins();
  await repo.remove();
  await rm(remote, { recursive: true, force: true });
});

test('a docs-only push runs the full suite and logs a count, not the paths', async () => {
  const tip = await commit({
    [DOCS[0]]: '# gaps edited\n',
    [DOCS[1]]: '# notes edited\n',
  });
  const output = await push(tip, ZERO);
  expectFull(output, 2, DOCS);
  expect(output).toContain('2 file(s) changed');
});

test('a vendored .py push runs the full suite and logs a count, not the path', async () => {
  const before = await sha();
  await repo.git('push', '--quiet', 'origin', 'feat');
  const tip = await commit({ [VENDOR]: '# vendor edited\n' });
  expectFull(await push(tip, before), 1, [VENDOR, 'hf-docs-mcp.py']);
});

test('a module-only push stays on --changed', async () => {
  const before = await sha();
  await repo.git('push', '--quiet', 'origin', 'feat');
  const tip = await commit({ 'a.ts': 'export const value = 2;\n' });
  const output = await push(tip, before);
  expect(output).toContain('only the tests the push can reach');
  expect(output).toContain('A-TEST-RAN');
  expect(output).not.toContain('B-TEST-RAN');
  expect(output).not.toContain('non-module file(s)');
  expect(output).not.toContain('(IN FULL)');
});

test('a package.json push still runs the full suite, without naming the file', async () => {
  const before = await sha();
  await repo.git('push', '--quiet', 'origin', 'feat');
  const tip = await commit({
    'package.json': JSON.stringify({ ...PROBE, version: '0.0.1' }, null, 2),
  });
  expectFull(await push(tip, before), 1, ['package.json']);
});
