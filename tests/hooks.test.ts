/**
 * Guards the git hooks.
 *
 * ★ WHY TEST HOOKS. They run on a contributor's machine, not in CI, so a broken one
 *   fails in the place nobody is watching — and the usual response to a confusing hook
 *   failure is `--no-verify`, which disables the SECRET scan along with it.
 */
import { describe, expect, test } from 'bun:test';

async function hook(name: string): Promise<string> {
  return await Bun.file(new URL(`../.husky/${name}`, import.meta.url)).text();
}

const RUNNER = 'bun packages/config/bin/hooks.ts';

describe('the git hooks', () => {
  test('pre-commit runs the shared step FIRST, because it scans for secrets first', async () => {
    // ⛔ Order matters: every other check can be fixed after the fact, a leaked credential
    //   cannot. The shared pre-commit runs gitleaks before it formats anything —
    //   packages/config/tests/hooks-precommit.test.ts pins that order from the inside.
    const first = (await hook('pre-commit')).split('\n').find((l) => l.startsWith('bun '));
    expect(first).toBe(`${RUNNER} pre-commit || exit 1`);
  });

  test('every hook line fails the hook on a non-zero exit', async () => {
    // ⚠️ Without `|| exit 1`, a failing script prints its complaint and the commit
    //   proceeds anyway — the worst kind of gate, one that looks present. git runs these
    //   files with plain `sh` now (no husky `sh -e`), so the suffix is the only guarantee.
    for (const name of ['pre-commit', 'pre-push']) {
      const lines = (await hook(name)).split('\n').filter((l) => l.startsWith('bun '));

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toContain('|| exit 1');
    }
  });

  test('each hook script referenced actually exists', async () => {
    for (const name of ['pre-commit', 'pre-push']) {
      const scripts = [...(await hook(name)).matchAll(/bun run (scripts\/\S+)/g)].map(
        (m) => m[1] ?? '',
      );

      for (const script of scripts) {
        const exists = await Bun.file(new URL(`../${script}`, import.meta.url)).exists();
        expect(exists).toBe(true);
      }
    }
    // ⚠️ The workspace path. Everywhere else in the estate the same runner is reached as
    //   node_modules/@homeflare/config/bin/hooks.ts; here nothing depends on the package,
    //   so Bun links no copy — see the comment in .husky/pre-commit.
    const runner = new URL('../packages/config/bin/hooks.ts', import.meta.url);
    expect(await Bun.file(runner).exists()).toBe(true);
  });

  test("pre-push is the shared, push-scoped gate, and passes git's arguments on", async () => {
    // ★ It used to run the whole `verify` (~60s, every test, the smoke test) on every push.
    //   The shared pre-push runs `check`'s lint and types, and only the tests the pushed
    //   files can reach; CI runs everything on the pull request.
    expect(await hook('pre-push')).toContain(`${RUNNER} pre-push "$@" || exit 1`);
  });

  test('install activates the tracked hooks for every worktree, not husky', async () => {
    // 🔴 husky's `.husky/_` exists only in a worktree where `bun install` ran husky, so
    //   every other worktree of the clone committed with no hooks at all.
    const pkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts['prepare']).toBe(`${RUNNER} activate`);
    expect(pkg.devDependencies['husky']).toBeUndefined();
  });
});
