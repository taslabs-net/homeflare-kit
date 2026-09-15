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

describe('husky hooks', () => {
  test('pre-commit scans for secrets FIRST', async () => {
    // ⛔ Order matters: every other check can be fixed after the fact, a leaked
    //   credential cannot. It must not sit behind a slower gate that might fail first.
    const first = (await hook('pre-commit')).split('\n').find((l) => l.startsWith('bun run'));

    expect(first).toContain('secrets.ts');
  });

  test('every hook line fails the hook on a non-zero exit', async () => {
    // ⚠️ Without `|| exit 1`, a failing script prints its complaint and the commit
    //   proceeds anyway — the worst kind of gate, one that looks present.
    for (const name of ['pre-commit', 'pre-push']) {
      const lines = (await hook(name)).split('\n').filter((l) => l.startsWith('bun run'));

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
  });

  test('format-staged covers every extension oxfmt checks, markdown included', async () => {
    // ⚠️ THE GAP THIS CLOSES, measured 2026-09-15. The hook filtered to TS/JS/JSON while
    //   `oxfmt --check .` also formats .md, so an unformatted changeset passed the commit
    //   hook and failed the push. A hook that checks LESS than CI trains people to
    //   distrust it, which is worse than having no hook.
    const src = await Bun.file(
      new URL('../scripts/hooks/format-staged.ts', import.meta.url),
    ).text();

    expect(src).toContain('md');
  });

  test('pre-push runs the same gate as CI', async () => {
    expect(await hook('pre-push')).toContain('verify.ts');
  });
});
