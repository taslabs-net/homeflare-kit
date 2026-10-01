/**
 * The wrapper every repo commits, and the runner's check that the committed copy is current.
 *
 * ★ TWO FAILURES THE WRAPPER ITSELF MUST NAME. With no `bun` on PATH the shell's own `exec: bun:
 *   not found` was the whole message — no fix line, on a machine whose fix is installing bun.
 *   With no runner it says `bun install`. Both are run under `sh` the way git runs them.
 * 🔴 A STALE WRAPPER IS THE ROLLOUT HOLE. The version bumper refreshes the dependency and never
 *   `.husky/*`, so a consumer keeps the wrapper it committed — the one that exited 0 with no
 *   `node_modules`. The runner now stops when `.husky/<hook>` is one of OURS and not the
 *   current one, and says how to refresh it. A hook file a repo wrote for itself (this
 *   repository's own run kit-only scripts after the shared runner) is not ours to compare.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HUSKY_HOOK, installHooks } from '../src/hooks.ts';
import { ENV, pathWith, removeBins, scratchRepo, spawn } from './hooks-harness.ts';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await removeBins();
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(async () => await rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The wrapper as 84b69fe and 8ceb21d shipped it: it already fails closed, and has no `bun` check. */
const ONE_VERSION_BACK = HUSKY_HOOK.replace(/if ! command -v bun[\s\S]*?\nfi\n/, '');

/** The wrapper before 2026-10-01: the one every adopted repo has committed today. */
const SKIPPING = `# HomeFlare shared git hook. The behaviour lives in @homeflare/config, not in this file,
# and the same bytes are installed as .husky/pre-commit and .husky/pre-push.
#
# Regenerate this file with: bun node_modules/@homeflare/config/bin/hooks.ts install
hook="node_modules/@homeflare/config/bin/hooks.ts"
if [ ! -f "$hook" ]; then
  echo "homeflare hooks: $hook is missing — run 'bun install' in this worktree; skipping" >&2
  exit 0
fi
exec bun "$hook" "$(basename "$0")" "$@"
`;

describe('the wrapper without bun', () => {
  test('exits 1 and says to install bun, instead of "exec: bun: not found"', async () => {
    const dir = await temp('hf-wrapper-nobun-');
    const empty = await temp('hf-wrapper-emptypath-');
    await installHooks(dir);

    const result = await spawn(['/bin/sh', '.husky/pre-commit'], dir, { PATH: empty });

    expect(result.code).toBe(1);
    expect(result.output.trim().split('\n')).toHaveLength(1);
    expect(result.output).toContain('bun is not on PATH');
    expect(result.output).toContain('https://bun.sh');
    expect(result.output).not.toContain('not found');
  });

  test('says so even when the runner is present — bun is what runs it', async () => {
    const dir = await temp('hf-wrapper-nobun-runner-');
    const empty = await temp('hf-wrapper-emptypath-');
    await installHooks(dir);
    await Bun.write(join(dir, 'node_modules/@homeflare/config/bin/hooks.ts'), '');

    const result = await spawn(['/bin/sh', '.husky/pre-push', 'origin', 'url'], dir, {
      PATH: empty,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('bun is not on PATH');
  });
});

describe('the runner and a stale wrapper', () => {
  /** A scratch repo with `.husky/<hook>` holding `text`, and a gitleaks that finds nothing. */
  async function withWrapper(text: string, hook: 'pre-commit' | 'pre-push') {
    const repo = await scratchRepo('hf-drift-');
    cleanups.push(async () => await repo.remove());
    await repo.write(`.husky/${hook}`, text);
    await chmod(join(repo.dir, '.husky', hook), 0o755);
    await repo.write('package.json', JSON.stringify({ scripts: { check: 'echo CHECK-RAN' } }));
    return { repo, env: { ...ENV, PATH: await pathWith(0) } };
  }

  for (const hook of ['pre-commit', 'pre-push'] as const) {
    test(`${hook}: the wrapper from before today stops the hook, naming the refresh`, async () => {
      const { repo, env } = await withWrapper(SKIPPING, hook);

      const result = await repo.hook(hook, { env, args: ['origin', 'url'] });

      expect(result.code).toBe(1);
      expect(result.output).toContain(`.husky/${hook} is an out-of-date or edited`);
      expect(result.output).toContain(
        'fix:    bun node_modules/@homeflare/config/bin/hooks.ts install',
      );
      expect(result.output).toContain('then commit .husky/pre-commit and .husky/pre-push');
      expect(result.output).not.toContain('--no-verify');
    });
  }

  test('the wrapper one version back (no bun check) is stale too', async () => {
    const { repo, env } = await withWrapper(ONE_VERSION_BACK, 'pre-commit');
    expect(ONE_VERSION_BACK).not.toBe(HUSKY_HOOK);

    const result = await repo.hook('pre-commit', { env });

    expect(result.code).toBe(1);
    expect(result.output).toContain('out-of-date or edited');
  });

  test('an edited current wrapper is drift as well', async () => {
    const { repo, env } = await withWrapper(`${HUSKY_HOOK}echo "local tweak"\n`, 'pre-commit');

    expect((await repo.hook('pre-commit', { env })).code).toBe(1);
  });

  test('the current wrapper passes, and `install` is the fix that makes a stale one pass', async () => {
    const { repo, env } = await withWrapper(SKIPPING, 'pre-commit');
    expect((await repo.hook('pre-commit', { env })).code).toBe(1);

    const installed = await repo.hook('install', { env });
    expect(installed.code).toBe(0);
    expect(await Bun.file(join(repo.dir, '.husky/pre-commit')).text()).toBe(HUSKY_HOOK);

    const result = await repo.hook('pre-commit', { env });
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing staged');
  });

  test("a hook file the repo wrote for itself is not compared — this repository's own are", async () => {
    const own =
      '# One script per concern.\nbun packages/config/bin/hooks.ts pre-commit || exit 1\n';
    const { repo, env } = await withWrapper(own, 'pre-commit');

    const result = await repo.hook('pre-commit', { env });

    expect(result.code).toBe(0);
    expect(result.output).not.toContain('out-of-date');
  });

  test('no .husky at all: nothing to compare', async () => {
    const repo = await scratchRepo('hf-drift-none-');
    cleanups.push(async () => await repo.remove());

    expect((await repo.hook('pre-commit', { env: { ...ENV, PATH: await pathWith(0) } })).code).toBe(
      0,
    );
  });
});
