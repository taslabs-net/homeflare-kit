/**
 * ★ The wrapper's CONTENT is the contract. Every repo commits these exact bytes, so a
 *   change here is a change to fourteen repos and must be deliberate enough to fail a
 *   test first.
 */
import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HOOK_NAMES, HUSKY_HOOK, PREPARE, installHooks, problemsInHooks } from '../src/hooks.ts';

async function scratch(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-hooks-'));
  await Bun.write(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

async function within(manifest: unknown, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await scratch(manifest);
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ADOPTED = { name: 'probe', scripts: { prepare: PREPARE } };

describe('the wrapper', () => {
  test('names the runner by a repo-root-relative path, because git runs hooks there', () => {
    expect(HUSKY_HOOK).toContain('node_modules/@homeflare/config/bin/hooks.ts');
  });

  test('takes the hook name from $0, so both files are byte-identical', () => {
    expect(HUSKY_HOOK).toContain('"$(basename "$0")"');
  });

  test("passes git's arguments through — pre-push needs the remote name", () => {
    // ⚠️ stdin rides along with `exec` untouched; the arguments must be named.
    expect(HUSKY_HOOK).toContain('exec bun "$hook" "$(basename "$0")" "$@"');
  });

  // ⚠️ Failing open is the deliberate trade — see install.ts. A regression here would
  //   make every commit in an uninstalled worktree fail on module resolution.
  test('exits 0 when the runner is absent rather than blocking the commit', () => {
    expect(HUSKY_HOOK).toContain('exit 0');
    expect(HUSKY_HOOK).toContain("run 'bun install' in this worktree");
  });

  test('says a hook is not the gate', () => {
    expect(HUSKY_HOOK).toContain('--no-verify');
    expect(HUSKY_HOOK).toContain('required checks on main');
  });

  test('prepare activates through the same runner', () => {
    expect(PREPARE).toBe('bun node_modules/@homeflare/config/bin/hooks.ts activate');
  });
});

describe('installHooks', () => {
  test('writes both hooks, executable, with identical content', async () => {
    await within({ name: 'probe' }, async (dir) => {
      const written = await installHooks(dir);
      expect(written).toEqual(['.husky/pre-commit', '.husky/pre-push']);

      for (const name of HOOK_NAMES) {
        const path = join(dir, '.husky', name);
        expect(await Bun.file(path).text()).toBe(HUSKY_HOOK);
        expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);
      }
    });
  });
});

describe('problemsInHooks', () => {
  test('reports a project that has adopted nothing', async () => {
    await within({ name: 'probe' }, async (dir) => {
      const problems = await problemsInHooks(dir);
      expect(problems.some((p) => p.includes('"prepare" does not run'))).toBe(true);
      expect(problems.filter((p) => p.includes('missing')).length).toBe(2);
    });
  });

  test('is empty once prepare activates and both wrappers are in place — no husky needed', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      expect(await problemsInHooks(dir)).toEqual([]);
    });
  });

  test('reports husky still in prepare — it re-points core.hooksPath at .husky/_', async () => {
    await within({ scripts: { prepare: `husky && ${PREPARE}` } }, async (dir) => {
      await installHooks(dir);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('still runs husky');
    });
  });

  test('reports a wrapper git would ignore because it is not executable', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      await chmod(join(dir, '.husky/pre-push'), 0o644);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('not executable');
    });
  });

  // ⛔ This is the whole point of owning the text centrally: a repo that edits its copy
  //   is drift, and drift that nothing reports is how fourteen copies happen.
  test('reports an edited wrapper as drift', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      await Bun.write(join(dir, '.husky/pre-push'), `${HUSKY_HOOK}echo "local tweak"\n`);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('.husky/pre-push');
      expect(problems[0]).toContain('differs');
    });
  });
});
