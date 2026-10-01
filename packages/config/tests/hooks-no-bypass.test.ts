/**
 * Hooks fail closed (Tim, 2026-10-01), and a failure says what failed and the fix — never
 * how to get round it.
 *
 * ★ EVERY FAILURE PATH THE HOOKS HAVE IS RUN, AND ITS OUTPUT READ. A bypass suggestion that
 *   survives in one rarely-hit branch teaches the reflex as surely as one on the main path,
 *   so this walks the branches rather than trusting a grep of the source to find them all —
 *   and then greps the source as well, for the branches a test cannot reach cheaply.
 * ⚠️ NOT MOCKED: hooks-harness.ts says why. Each scenario is a real hook in a real scratch
 *   repository, and each removes its directory in `finally`.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { HUSKY_HOOK } from '../src/hooks.ts';
import {
  ENV,
  type Result,
  type Scratch,
  pathWith,
  removeBins,
  scratchRepo,
} from './hooks-harness.ts';

const ZERO = '0'.repeat(40);

afterAll(removeBins);

/** What a failing hook must be: exit 1, a `fix:` line, and no way round it. */
function expectsClosedFailure(result: Result): void {
  expect(result.code).toBe(1);
  expect(result.output).toContain('fix:');
  expect(result.output).not.toContain('--no-verify');
  expect(result.output.toLowerCase()).not.toContain('bypass');
}

/**
 * A scratch repository with everything committed (`node_modules` ignored: the working tree
 * must be the commit) and a `check` script, optionally without node_modules.
 */
async function pushRepo(check: string, installed: boolean) {
  const repo = await scratchRepo('hf-nobypass-');
  if (!installed) await rm(join(repo.dir, 'node_modules'), { recursive: true, force: true });
  const scripts = { check, lint: 'exit 3', build: 'echo built' };
  await repo.write('package.json', JSON.stringify({ scripts }));
  await repo.write('.gitignore', 'node_modules\n');
  await repo.git('add', '-A');
  await repo.git('commit', '--quiet', '-m', 'seed');
  const head = (await repo.git('rev-parse', 'HEAD')).trim();
  return { repo, head };
}

/** One commit that is not `HEAD`, without moving `HEAD`. */
const elsewhere = async (repo: Scratch, head: string): Promise<string> =>
  (await repo.git('commit-tree', '-p', head, '-m', 'x', `${head}^{tree}`)).trim();

/**
 * Run pre-push in a fresh repository and expect a closed failure. `gitleaks` is the shim's
 * exit code, or `'absent'`; `stdinFor` builds the refs (default: `HEAD` to a new branch).
 */
async function pushFails(
  check: string,
  options: {
    installed?: boolean;
    gitleaks?: number | 'absent';
    prepare?: (repo: Scratch, head: string) => Promise<void>;
    stdinFor?: (repo: Scratch, head: string) => Promise<string>;
  } = {},
): Promise<Result> {
  const { repo, head } = await pushRepo(check, options.installed ?? true);
  try {
    await options.prepare?.(repo, head);
    const stdin =
      (await options.stdinFor?.(repo, head)) ?? `refs/heads/main ${head} refs/heads/main ${ZERO}`;
    const env = { ...ENV, PATH: await pathWith(options.gitleaks ?? 0) };
    const result = await repo.hook('pre-push', {
      env,
      args: ['nowhere', 'url'],
      stdin: `${stdin}\n`,
    });
    expectsClosedFailure(result);
    return result;
  } finally {
    await repo.remove();
  }
}

describe('pre-commit failures', () => {
  test('gitleaks missing', async () => {
    const repo = await scratchRepo('hf-nobypass-');
    try {
      const env = { ...ENV, PATH: await pathWith('absent') };
      expectsClosedFailure(await repo.hook('pre-commit', { env }));
    } finally {
      await repo.remove();
    }
  });

  test('gitleaks finds a secret', async () => {
    const repo = await scratchRepo('hf-nobypass-');
    try {
      const env = { ...ENV, PATH: await pathWith(1) };
      expectsClosedFailure(await repo.hook('pre-commit', { env }));
    } finally {
      await repo.remove();
    }
  });

  test('no node_modules', async () => {
    const repo = await scratchRepo('hf-nobypass-');
    try {
      await rm(join(repo.dir, 'node_modules'), { recursive: true, force: true });
      const env = { ...ENV, PATH: await pathWith(0) };
      const result = await repo.hook('pre-commit', { env });
      expectsClosedFailure(result);
      expect(result.output).toContain("run 'bun install'");
    } finally {
      await repo.remove();
    }
  });

  test('a stale wrapper', async () => {
    const repo = await scratchRepo('hf-nobypass-');
    try {
      await repo.write(
        '.husky/pre-commit',
        '# HomeFlare shared git hook. An older copy.\nexit 0\n',
      );
      const env = { ...ENV, PATH: await pathWith(0) };
      const result = await repo.hook('pre-commit', { env });
      expectsClosedFailure(result);
      expect(result.output).toContain('hooks.ts install');
    } finally {
      await repo.remove();
    }
  });

  test('a half-staged unformatted file', async () => {
    const repo = await scratchRepo('hf-nobypass-');
    try {
      await repo.write('half.ts', "export const a = 'formatted';\n");
      await repo.git('add', 'half.ts');
      await repo.git('commit', '--quiet', '-m', 'seed');
      await repo.write('half.ts', "export const a = 'staged';\n");
      await repo.git('add', 'half.ts');
      await repo.write('half.ts', "export const a = 'staged';\nexport const b  =  {c:1}\n");
      const env = { ...ENV, PATH: await pathWith(0) };
      expectsClosedFailure(await repo.hook('pre-commit', { env }));
    } finally {
      await repo.remove();
    }
  });
});

describe('pre-push failures', () => {
  test('a failing lane', async () => {
    await pushFails('bun run lint');
  });

  test('no node_modules', async () => {
    const result = await pushFails('echo ok', { installed: false });
    expect(result.output).toContain("run 'bun install'");
  });

  test('no check script', async () => {
    const result = await pushFails('echo ok', {
      prepare: async (repo) => await repo.write('package.json', JSON.stringify({ name: 'probe' })),
    });
    expect(result.output).toContain('no `check` script');
  });

  test('a check whose every lane is skipped', async () => {
    const result = await pushFails('bun run build');
    expect(result.output).toContain('every lane of `check` was skipped');
  });

  test('a ref that is not checked out', async () => {
    await pushFails('echo ok', {
      stdinFor: async (repo, head) =>
        `refs/heads/other ${await elsewhere(repo, head)} refs/heads/other ${ZERO}`,
    });
  });

  test('a mixed push: the checked-out ref with one that is not', async () => {
    await pushFails('echo ok', {
      stdinFor: async (repo, head) =>
        `refs/heads/main ${head} refs/heads/main ${ZERO}\n` +
        `refs/heads/other ${await elsewhere(repo, head)} refs/heads/other ${ZERO}`,
    });
  });

  test('a working tree that is not the commit', async () => {
    const result = await pushFails('echo ok', {
      prepare: async (repo) => await repo.write('stray.txt', 'uncommitted\n'),
    });
    expect(result.output).toContain('uncommitted changes');
  });

  test('gitleaks missing: the pushed commits were not scanned', async () => {
    const result = await pushFails('echo ok', { gitleaks: 'absent' });
    expect(result.output).toContain('NOT scanned');
  });

  test('gitleaks finds a secret in what is pushed', async () => {
    const result = await pushFails('echo ok', { gitleaks: 1 });
    expect(result.output).toContain('ROTATE');
  });
});

describe('the sources', () => {
  // ⛔ A grep, because three branches (oxfmt could not format, oxlint found problems, a
  //   restage failed) need a broken toolchain to reach. The flag may not appear in a hook's
  //   own source at all: a comment that argues for it is how the next message gets written.
  test('no hook source mentions the bypass flag', async () => {
    const roots = [
      new URL('../src/hooks/', import.meta.url).pathname,
      new URL('../../../scripts/hooks/', import.meta.url).pathname,
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const name of (await readdir(root)).filter((file) => file.endsWith('.ts'))) {
        if ((await Bun.file(join(root, name)).text()).includes('--no-verify')) {
          offenders.push(join(root, name));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the wrapper every repo commits does not mention it either', () => {
    expect(HUSKY_HOOK).not.toContain('--no-verify');
  });
});
