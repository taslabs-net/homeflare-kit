/**
 * Two pre-commit bugs, measured 2026-09-23, reproduced against the REAL pinned oxfmt/oxlint
 * binaries (hooks-harness.ts explains why nothing here is mocked):
 *
 * BUG 1 — a staged file wholly excluded by oxfmt's (or oxlint's) own `ignorePatterns` made
 *   the hook FAIL: `staged()` classifies by file extension only, blind to ignore rules, so
 *   oxfmt/oxlint got a file list they then refused to touch. Measured in homeflare-kit
 *   committing only `packages/distilled-netbox/src/credentials.ts`.
 * BUG 2 — the hook ran bare `oxfmt`, which auto-discovers only `.oxfmtrc.json`/`.jsonc`.
 *   A repo configured with only `.oxfmtrc.mjs` got formatted with oxfmt's built-in defaults
 *   instead of its own style. Measured by the homeflare-desktop docs agent.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ENV, type Scratch, scratchRepo } from './hooks-harness.ts';

let active: Scratch | undefined;

afterEach(async () => {
  await active?.remove();
  active = undefined;
});

async function repoWithoutDefaultConfig(): Promise<Scratch> {
  const repo = await scratchRepo('hf-hook-config-');
  active = repo;
  // ⛔ scratchRepo() always seeds a bare `.oxfmtrc.json` — remove it so a test can set up
  //   the exact config shape (or absence) it means to exercise, without that default
  //   silently winning via auto-discovery.
  await rm(join(repo.dir, '.oxfmtrc.json'), { force: true });
  return repo;
}

describe('BUG 1 — every staged file excluded by ignore rules', () => {
  test('oxfmt-ignored file: passes and says nothing was formattable, not a failure', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write(
      '.oxfmtrc.json',
      JSON.stringify({ singleQuote: true, ignorePatterns: ['vendor/**'] }),
    );
    await repo.write('vendor/credentials.ts', 'export const   x=1;\n');
    await repo.git('add', 'vendor/credentials.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(0);
    expect(result.output).toContain('no formattable staged files');
    // 🔴 THE REGRESSION THIS EXISTS FOR: before the fix, this exact scenario failed with
    //   "oxfmt could not format the staged files" and exit 1.
    expect(result.output).not.toContain('could not format');
    // The ignored file must reach the commit UNTOUCHED — the hook never even ran oxfmt on it
    // in a way that could rewrite it (write mode ran, but oxfmt itself excluded the file).
    expect(await repo.git('show', ':vendor/credentials.ts')).toBe('export const   x=1;\n');
  });

  test('oxlint-ignored file: the lint step passes too, same shape as oxfmt', async () => {
    const repo = await repoWithoutDefaultConfig();
    // Not oxfmt-ignored (so the formatter genuinely runs on it) — only oxlint excludes it.
    await repo.write('.oxfmtrc.json', JSON.stringify({ singleQuote: true }));
    await repo.write('.oxlintrc.json', JSON.stringify({ ignorePatterns: ['vendor/**'] }));
    await repo.write('vendor/credentials.ts', "export const x = 'already-formatted';\n");
    await repo.git('add', 'vendor/credentials.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(0);
    expect(result.output).not.toContain('No files found to lint');
    expect(result.output).not.toContain('oxlint found problems');
  });

  test('a real oxfmt failure in the same commit still fails — the flag is narrow', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write('.oxfmtrc.json', JSON.stringify({ singleQuote: true }));
    // Unparseable — a genuine formatting failure, not an "unmatched pattern" one.
    await repo.write('broken.ts', 'export const x = {\n');
    await repo.git('add', 'broken.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(1);
    expect(result.output).toContain('oxfmt could not format the staged files');
  });
});

describe('BUG 2 — oxfmt config discovery', () => {
  test('.oxfmtrc.mjs only: the hook applies IT, not oxfmt defaults', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write('.oxfmtrc.mjs', 'export default { singleQuote: true };\n');
    // Double-quoted: wrong under the .mjs config, fine under oxfmt's own defaults. If the
    // hook silently fell back to defaults (the bug), this file would reach the commit
    // unchanged with double quotes.
    await repo.write('sample.ts', 'export const greeting = "hello";\n');
    await repo.git('add', 'sample.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(0);
    expect(result.output).toContain('rewrote and restaged');
    const committed = await repo.git('show', ':sample.ts');
    expect(committed).toContain("'hello'");
    expect(committed).not.toContain('"hello"');
  });

  test('.oxfmtrc.json still wins with no --config needed (unchanged behaviour)', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write('.oxfmtrc.json', JSON.stringify({ singleQuote: true }));
    await repo.write('sample.ts', 'export const greeting = "hello";\n');
    await repo.git('add', 'sample.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(0);
    expect(await repo.git('show', ':sample.ts')).toContain("'hello'");
  });

  test('two unrecognized configs: refuses loudly instead of guessing', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write('.oxfmtrc.mjs', 'export default { singleQuote: true };\n');
    await repo.write('.oxfmtrc.cjs', 'module.exports = { singleQuote: false };\n');
    await repo.write('sample.ts', 'export const greeting = "hello";\n');
    await repo.git('add', 'sample.ts');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(1);
    expect(result.output).toContain('.oxfmtrc.mjs');
    expect(result.output).toContain('.oxfmtrc.cjs');
    expect(result.output).toContain('keep exactly one');
  });

  // 🔴 FOUND IN REVIEW: the ambiguous check ran unconditionally, before `staged()`, so it
  //   blocked a commit that would never have touched oxfmt at all — exactly what BUG 1's
  //   fix exists to prevent. It must be gated on oxfmt ever actually needing to run.
  test('an unrelated commit is not blocked by an ambiguous config it would never reach', async () => {
    const repo = await repoWithoutDefaultConfig();
    await repo.write('.oxfmtrc.mjs', 'export default { singleQuote: true };\n');
    await repo.write('.oxfmtrc.cjs', 'module.exports = { singleQuote: false };\n');
    // Not `.ts`/`.md`/etc — staged() never classifies this as formattable, so oxfmt/oxlint
    // (and the config that governs them) are never consulted for this commit.
    await repo.write('notes.txt', 'unrelated change\n');
    await repo.git('add', 'notes.txt');

    const result = await repo.hook('pre-commit', { env: ENV });

    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing staged to format');
    expect(result.output).not.toContain('oxfmt configs found');
  });
});
