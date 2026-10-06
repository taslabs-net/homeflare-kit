/**
 * Gaps in the changed-file → test mapping that a string search of the test file misses.
 *
 * 🔴 MEASURED 2026-10-06, bun 1.4.0: a selected path `--test-name-pattern=splits|unused.test.ts`
 *   is still a bun option after shell quoting, so a passing test named `splits` runs and the
 *   failing reader is filtered (exit 0). `./<path>` keeps it a path.
 * 🔴 A new `docs/unit-gaps-foo.md` is found by `readdirSync` plus a regex, and `fixtures/a.json`
 *   is too short to search for. Neither string is in a test. An add with no reader runs the
 *   suite in full; a later edit of that file stays on `--changed`.
 * 🔴 A vendored path that lives only in a module the test imports (not in the test text, and
 *   not in a comment) must still select that test.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, pathWith, removeBins, scratchRepo, spawn } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);
const DASH = '--test-name-pattern=splits|unused.test.ts';
const FULL = '2 added non-module path(s) named by no test — tests in full';

const repo: Scratch = await scratchRepo('hf-read-gaps-');
const remote = await mkdtemp(join(tmpdir(), 'hf-read-gaps-remote-')).catch(
  async (error: unknown) => {
    await repo.remove();
    throw error;
  },
);
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
  await mkdir(join(repo.dir, 'src/other-vendor/ingest'), { recursive: true });
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
      "  console.log('MOD-RAN');",
      '  expect(value).toBeGreaterThan(0);',
      '});',
      '',
    ].join('\n'),
  );
  await repo.write(
    'tests/listed.test.ts',
    [
      "import { readdirSync } from 'node:fs';",
      "import { expect, test } from 'bun:test';",
      "test('listed gaps', () => {",
      "  const names = readdirSync('docs').filter((name) => /^unit-gaps-.+\\.md$/.test(name));",
      "  console.log('LISTED-RAN');",
      '  expect(names.length).toBeGreaterThan(0);',
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('src/other-vendor/ingest/notes.py', 'py\n');
  await repo.write('src/other-vendor/SHA256SUMS', 'pin\n');
  await repo.write(
    'src/other-pin.ts',
    [
      '/** The test reaches the tree only by importing this module. */',
      "export const tree = 'src/other-vendor/';",
      "export const url = new URL('./other-vendor/', import.meta.url);",
      '',
    ].join('\n'),
  );
  await repo.write(
    'tests/other-vendor.test.ts',
    [
      "import { readFileSync } from 'node:fs';",
      "import { expect, test } from 'bun:test';",
      "import { tree } from '../src/other-pin.ts';",
      '// The path string lives in the imported module, not in this file.',
      "test('other vendor', () => {",
      "  const text = readFileSync(tree + 'SHA256SUMS', 'utf8');",
      "  console.log('INDIRECT-RAN');",
      "  expect(text).toContain('pin');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('docs/dash-doc.md', 'keep\n');
  await repo.write(
    'decoy.test.ts',
    [
      "import { test } from 'bun:test';",
      '// docs/dash-doc.md',
      "test('splits', () => {",
      "  console.log('DECOY-RAN');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.write(
    'reader.test.ts',
    [
      "import { readFileSync } from 'node:fs';",
      "import { expect, test } from 'bun:test';",
      "test('reader fails closed', () => {",
      "  const text = readFileSync('docs/dash-doc.md', 'utf8');",
      "  console.log('READER-RAN');",
      "  expect(text).toContain('keep');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.write(
    DASH,
    [
      "import { test } from 'bun:test';",
      '// docs/dash-doc.md',
      "test('dash file', () => {",
      "  console.log('DASHFILE-RAN');",
      '});',
      '',
    ].join('\n'),
  );
  await repo.git('add', '.');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
});

test('a vendored edit selects the test that only names it through an import', async () => {
  const tip = await commit('src/other-vendor/ingest/notes.py', 'py changed\n');
  const result = await push(tip, ZERO);

  expect(result.code).toBe(0);
  expect(result.output).toContain('INDIRECT-RAN');
  expect(result.output).not.toContain('LISTED-RAN');
  expect(result.output).not.toContain('MOD-RAN');
  expect(result.output).toContain(
    'added 1 extra test file(s) — 1 changed non-module path(s) named in a test',
  );
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('an added file no test names runs the suite in full', async () => {
  const before = await sha();
  await mkdir(join(repo.dir, 'fixtures'), { recursive: true });
  await repo.write('docs/unit-gaps-foo.md', 'new gap\n');
  await repo.write('fixtures/a.json', '{}\n');
  await repo.git('add', '--', 'docs/unit-gaps-foo.md', 'fixtures/a.json');
  await repo.git('commit', '--quiet', '-m', 'add unnamed data');
  const result = await push(await sha(), before);

  expect(result.code).toBe(0);
  expect(result.output).toContain(FULL);
  expect(result.output).toContain('LISTED-RAN');
  expect(result.output).toContain('MOD-RAN');
  expect(result.output).toContain('(IN FULL)');
  expect(result.output).not.toContain('extra test file');
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('a later edit of a file no test names stays on --changed', async () => {
  const before = await sha();
  const tip = await commit('docs/unit-gaps-foo.md', 'edited gap\n');
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  expect(result.output).toContain('no test files are affected');
  expect(result.output).not.toContain('LISTED-RAN');
  expect(result.output).not.toContain('tests in full');
  expect(result.output).not.toContain('extra test file');
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('a test path starting with - still runs the failing reader', async () => {
  const before = await sha();
  const tip = await commit('docs/dash-doc.md', 'gone\n');
  const result = await push(tip, before);

  expect(result.output).toContain('READER-RAN');
  expect(result.code).not.toBe(0);
});
