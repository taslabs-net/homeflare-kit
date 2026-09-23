/**
 * pre-commit, run as git runs it: a real index in a scratch repository.
 *
 * ★ Both formatting behaviours worth testing are about git's index — that the commit
 *   captures the FORMATTED bytes, and that a half-staged file is never swept in — and the
 *   secret scan must run first and fail closed. hooks-harness.ts says why none of it is mocked.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ENV, type Scratch, pathWith, scratchRepo } from './hooks-harness.ts';

const UGLY = 'export const value  =   {a:1,   b:2}\n';

/**
 * ⛔ TOP-LEVEL AWAIT, NOT A `let` FILLED BY `beforeAll`: if setup threw before the
 *   assignment, every path here would be relative to the process's working directory —
 *   which is this repository.
 */
const repo: Scratch = await scratchRepo();
let clean: Record<string, string | undefined> = ENV;

beforeAll(async () => {
  clean = { ...ENV, PATH: await pathWith(0) };
});

afterAll(async () => {
  await repo.remove();
});

describe('the secret scan', () => {
  test('runs first, and a finding fails the commit with the rotate instruction', async () => {
    const result = await repo.hook('pre-commit', { env: { ...ENV, PATH: await pathWith(1) } });
    expect(result.code).toBe(1);
    expect(result.output).toContain('gitleaks found a secret');
    expect(result.output).toContain('ROTATE');
    // Nothing after it ran: the formatter never got to say "nothing staged".
    expect(result.output).not.toContain('nothing staged');
  });

  test('fails CLOSED when gitleaks is not installed — never a silent skip', async () => {
    const result = await repo.hook('pre-commit', {
      env: { ...ENV, PATH: await pathWith('absent') },
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('NOT scanned');
    expect(result.output).toContain('brew install gitleaks');
  });

  test('in a worktree nobody has installed: the scan still runs, the rest skips out loud', async () => {
    // ⚠️ A fresh worktree runs its hooks now; without node_modules, formatting would reach
    //   for an unpinned `bunx oxfmt`. The secret scan needs only the gitleaks binary.
    const bare = await scratchRepo('hf-hook-bare-');
    try {
      await rm(join(bare.dir, 'node_modules'), { recursive: true, force: true });
      await bare.write('ugly.ts', UGLY);
      await bare.git('add', 'ugly.ts');
      const result = await bare.hook('pre-commit', { env: clean });
      expect(result.code).toBe(0);
      expect(result.output).toContain('gitleaks found no secret');
      expect(result.output).toContain("run 'bun install'");
      expect(await bare.git('show', ':ugly.ts')).toBe(UGLY);
    } finally {
      await bare.remove();
    }
  });

  test('a clean scan says so and lets the commit continue', async () => {
    const result = await repo.hook('pre-commit', { env: clean });
    expect(result.code).toBe(0);
    expect(result.output).toContain('gitleaks found no secret');
  });
});

describe('format and lint', () => {
  test('passes with nothing staged and says so', async () => {
    const result = await repo.hook('pre-commit', { env: clean });
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing staged');
  });

  test('formats a staged file and restages it, so the COMMIT holds the formatted bytes', async () => {
    await repo.write('ugly.ts', UGLY);
    await repo.git('add', 'ugly.ts');

    const result = await repo.hook('pre-commit', { env: clean });
    expect(result.code).toBe(0);
    // ⚠️ The hook rewrites files during a commit; it must say which ones.
    expect(result.output).toContain('rewrote and restaged');
    expect(result.output).toContain('ugly.ts');

    // 🔴 THE REGRESSION THIS EXISTS FOR: formatting the worktree without restaging leaves
    //   the index holding the unformatted bytes, and CI fails a file that reads as clean
    //   locally. Read the index, not the worktree.
    expect(await repo.git('show', ':ugly.ts')).not.toBe(UGLY);
    expect(await repo.git('show', ':ugly.ts')).toBe(
      await Bun.file(join(repo.dir, 'ugly.ts')).text(),
    );
  });

  test('handles a path git would quote and escape', async () => {
    // 🔴 Measured 2026-09-22: without `-z`, `git diff --cached --name-only` applies
    //   core.quotePath and hands back the literal `"caf\303\251 .ts"` — a path that does not
    //   exist. oxfmt then fails on every commit touching the file, and the obvious response
    //   is `--no-verify`.
    const awkward = 'café note.md';
    await repo.write(awkward, '#  Heading\n\n\ntext\n');
    await repo.git('add', '--', awkward);

    const result = await repo.hook('pre-commit', { env: clean });

    expect(result.code).toBe(0);
    expect(result.output).toContain(awkward);
    expect(await repo.git('show', `:${awkward}`)).toBe(
      await Bun.file(join(repo.dir, awkward)).text(),
    );
  });

  test('refuses a half-staged unformatted file instead of staging the unstaged work', async () => {
    const keep = join(repo.dir, 'partial.ts');
    await Bun.write(keep, "export const a = 'formatted';\n");
    await repo.git('add', 'partial.ts');
    await repo.git('commit', '--quiet', '--no-verify', '-m', 'seed');

    await Bun.write(keep, "export const a = 'staged';\n");
    await repo.git('add', 'partial.ts');
    // Unstaged work on top of a staged change: the file is now only half in the index.
    const dirty = `export const a = 'staged';\nexport const b  =  {c:1}\n`;
    await Bun.write(keep, dirty);

    const result = await repo.hook('pre-commit', { env: clean });
    expect(result.code).toBe(1);
    expect(result.output).toContain('unstaged');
    // ⛔ The work in progress must be exactly as it was. A `git add` here is theft.
    expect(await Bun.file(keep).text()).toBe(dirty);
    expect(await repo.git('show', ':partial.ts')).toBe("export const a = 'staged';\n");
  });
});
