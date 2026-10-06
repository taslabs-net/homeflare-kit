/**
 * Import reads stay inside the repo, and a push that cannot bound them runs every test.
 *
 * 🔴 A relative import whose lexical path is inside the repo can be a symlink to
 *   somewhere else. `Bun.file().text()` follows it. The real path has to stay inside
 *   the checkout and outside `node_modules` and `.git`, or that text must not select
 *   a test.
 * 🔴 MEASURED: an import is read whole into a cache with no cap. One file over
 *   256 KiB, or imports together over 8 MiB, runs the suite in full. The reason is
 *   a count — the path is not printed.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV, type Scratch, pathWith, removeBins, scratchRepo, spawn } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);
const PER_FILE = 256 * 1024;
const AGGREGATE = 8 * 1024 * 1024;
const LIMIT = /(\d+) imported file\(s\), (\d+) bytes, over the 256 KiB \/ 8 MiB read limit/;

const repo: Scratch = await scratchRepo('hf-read-bounds-');
const remote = await mkdtemp(join(tmpdir(), 'hf-read-bounds-remote-')).catch(
  async (error: unknown) => {
    await repo.remove();
    throw error;
  },
);
const outside = await mkdtemp(join(tmpdir(), 'hf-read-bounds-outside-')).catch(
  async (error: unknown) => {
    await repo.remove();
    await rm(remote, { recursive: true, force: true });
    throw error;
  },
);
afterAll(async () => {
  await removeBins();
  await repo.remove();
  await rm(remote, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
const clean = { ...ENV, PATH: await pathWith(0) };

async function sha(ref = 'HEAD'): Promise<string> {
  return (await repo.git('rev-parse', ref)).trim();
}

async function commit(paths: readonly string[]): Promise<string> {
  await repo.git('add', '--', ...paths);
  await repo.git('commit', '--quiet', '-m', `edit ${paths.join(' ')}`);
  return await sha();
}

const push = (local: string, remoteSha: string) =>
  repo.hook('pre-push', {
    args: ['origin', remote],
    stdin: `refs/heads/feat ${local} refs/heads/feat ${remoteSha}\n`,
    env: clean,
  });

function reader(spec: string, marker: string): string {
  return [
    "import { expect, test } from 'bun:test';",
    `import { needle } from '${spec}';`,
    `test('${marker}', () => {`,
    `  console.log('${marker}');`,
    '  expect(needle.length).toBeGreaterThan(0);',
    '});',
    '',
  ].join('\n');
}

/** A module of exactly `size` bytes whose only path string is `needle`. */
async function writeModule(path: string, needle: string, size: number): Promise<void> {
  const head = `export const needle = ${JSON.stringify(needle)};\n/*`;
  const tail = '*/\n';
  const pad = size - Buffer.byteLength(head) - Buffer.byteLength(tail);
  if (pad < 1) throw new Error(`module head exceeds ${String(size)}`);
  const body = head + 'x'.repeat(pad) + tail;
  if (Buffer.byteLength(body) !== size) {
    throw new Error(`wrote ${String(Buffer.byteLength(body))} bytes, wanted ${String(size)}`);
  }
  await Bun.write(join(repo.dir, path), body);
}

function limitOf(output: string): { files: number; bytes: number } {
  const match = LIMIT.exec(output);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`no import read-limit note in:\n${output}`);
  }
  return { files: Number(match[1]), bytes: Number(match[2]) };
}

beforeAll(async () => {
  await spawn(['git', 'init', '--quiet', '--bare', remote], remote);
  await mkdir(join(repo.dir, 'src'), { recursive: true });
  await mkdir(join(repo.dir, 'docs'), { recursive: true });
  await mkdir(join(repo.dir, 'tests'), { recursive: true });
  await mkdir(join(repo.dir, 'node_modules/evil-pin'), { recursive: true });
  await repo.write(
    'package.json',
    JSON.stringify({ name: 'probe', private: true, scripts: { check: 'bun test' } }),
  );
  await repo.write('.gitignore', 'node_modules\nsrc/oversize/\nsrc/bulk/\n');
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
  await Bun.write(join(outside, 'outside.ts'), "export const needle = 'docs/via-symlink.md';\n");
  await Bun.write(
    join(repo.dir, 'node_modules/evil-pin/pin.ts'),
    "export const needle = 'docs/via-nm.md';\n",
  );
  await Bun.write(join(repo.dir, '.git/evil.ts'), "export const needle = 'docs/via-git.md';\n");
  await repo.write('src/pin.ts', "export const needle = 'docs/via-alias.md';\n");
  await symlink(join(outside, 'outside.ts'), join(repo.dir, 'src/escaped.ts'));
  await symlink('../node_modules/evil-pin/pin.ts', join(repo.dir, 'src/nm-link.ts'));
  await symlink('../.git/evil.ts', join(repo.dir, 'src/git-link.ts'));
  await symlink('pin.ts', join(repo.dir, 'src/alias.ts'));
  await repo.write('tests/escaped.test.ts', reader('../src/escaped.ts', 'LINK-RAN'));
  await repo.write('tests/nm.test.ts', reader('../src/nm-link.ts', 'NM-RAN'));
  await repo.write('tests/git.test.ts', reader('../src/git-link.ts', 'GIT-RAN'));
  await repo.write('tests/alias.test.ts', reader('../src/alias.ts', 'ALIAS-RAN'));
  for (const name of [
    'via-symlink.md',
    'via-nm.md',
    'via-git.md',
    'via-alias.md',
    'oversize.md',
    'agg.md',
  ]) {
    await repo.write(`docs/${name}`, 'seed\n');
  }
  await repo.git('add', '.');
  await repo.git('commit', '--quiet', '-m', 'seed');
  await repo.git('remote', 'add', 'origin', remote);
  await repo.git('push', '--quiet', 'origin', 'main');
  await repo.git('switch', '--quiet', '-c', 'feat');
});

test('a symlinked import outside the repo, node_modules, or .git does not select', async () => {
  await repo.write('docs/via-symlink.md', 'changed\n');
  await repo.write('docs/via-nm.md', 'changed\n');
  await repo.write('docs/via-git.md', 'changed\n');
  const tip = await commit(['docs/via-symlink.md', 'docs/via-nm.md', 'docs/via-git.md']);
  const result = await push(tip, ZERO);

  expect(result.code).toBe(0);
  expect(result.output).not.toContain('LINK-RAN');
  expect(result.output).not.toContain('NM-RAN');
  expect(result.output).not.toContain('GIT-RAN');
  expect(result.output).not.toContain('ALIAS-RAN');
  expect(result.output).toContain('no test files are affected');
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('a symlinked import whose real path stays in the repo still selects', async () => {
  const before = await sha();
  await repo.write('docs/via-alias.md', 'changed\n');
  const tip = await commit(['docs/via-alias.md']);
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  expect(result.output).toContain('ALIAS-RAN');
  expect(result.output).not.toContain('LINK-RAN');
  expect(result.output).not.toContain('MOD-RAN');
  expect(result.output).toContain('extra test file');
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('one import over 256 KiB runs the suite in full and reports a count', async () => {
  const before = await sha();
  await mkdir(join(repo.dir, 'src/oversize'), { recursive: true });
  await writeModule('src/oversize/pin.ts', 'docs/oversize.md', PER_FILE + 1);
  await repo.write('tests/oversize.test.ts', reader('../src/oversize/pin.ts', 'BIG-RAN'));
  await repo.write('docs/oversize.md', 'changed\n');
  const tip = await commit(['tests/oversize.test.ts', 'docs/oversize.md']);
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  const limit = limitOf(result.output);
  expect(limit.bytes).toBeGreaterThan(PER_FILE);
  expect(limit.bytes).toBeLessThan(AGGREGATE);
  expect(limit.files).toBeGreaterThan(0);
  const note = result.output.split('\n').find((line) => line.includes('read limit'));
  expect(note).toBeDefined();
  expect(note).not.toContain('oversize');
  expect(note).not.toContain('.ts');
  expect(result.output).toContain('(IN FULL)');
  expect(result.output).toContain('MOD-RAN');
  expect(result.output).toContain('BIG-RAN');
  expect(result.output).not.toContain('extra test file');
  await repo.git('push', '--quiet', 'origin', 'feat');
  await repo.git('rm', '--quiet', '--', 'tests/oversize.test.ts');
  await repo.git('commit', '--quiet', '-m', 'drop oversize reader');
  await rm(join(repo.dir, 'src/oversize'), { recursive: true, force: true });
  await repo.git('push', '--quiet', 'origin', 'feat');
});

test('imports over 8 MiB together run the suite in full and report a count', async () => {
  const before = await sha();
  await mkdir(join(repo.dir, 'src/bulk'), { recursive: true });
  const specs: string[] = [];
  for (let i = 0; i < 33; i += 1) {
    const path = `src/bulk/p${String(i)}.ts`;
    await writeModule(path, 'docs/agg.md', PER_FILE);
    specs.push(`import { needle as n${String(i)} } from '../${path}';`);
  }
  await repo.write(
    'tests/bulk.test.ts',
    [
      "import { expect, test } from 'bun:test';",
      ...specs,
      "test('bulk', () => {",
      "  console.log('BULK-RAN');",
      '  expect(n0.length).toBeGreaterThan(0);',
      '});',
      '',
    ].join('\n'),
  );
  await repo.write('docs/agg.md', 'changed\n');
  const tip = await commit(['tests/bulk.test.ts', 'docs/agg.md']);
  const result = await push(tip, before);

  expect(result.code).toBe(0);
  const limit = limitOf(result.output);
  expect(limit.bytes).toBeGreaterThan(AGGREGATE);
  expect(limit.files).toBeGreaterThan(1);
  const note = result.output.split('\n').find((line) => line.includes('read limit'));
  expect(note).toBeDefined();
  expect(note).not.toContain('bulk');
  expect(note).not.toContain('.ts');
  expect(result.output).toContain('(IN FULL)');
  expect(result.output).toContain('MOD-RAN');
  expect(result.output).toContain('BULK-RAN');
  expect(result.output).not.toContain('extra test file');
}, 120_000);
