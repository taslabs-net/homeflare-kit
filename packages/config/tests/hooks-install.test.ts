/**
 * ★ The wrapper's CONTENT is the contract. Every repo commits these exact bytes, so a
 *   change here is a change to fourteen repos and must be deliberate enough to fail a
 *   test first.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HOOK_NAMES, HUSKY_HOOK, installHooks, problemsInHooks } from '../src/hooks.ts';

async function scratch(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-hooks-'));
  await Bun.write(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

describe('the wrapper', () => {
  test('names the runner by a repo-root-relative path, because git runs hooks there', () => {
    expect(HUSKY_HOOK).toContain('node_modules/@homeflare/config/bin/hooks.ts');
  });

  test('takes the hook name from $0, so both files are byte-identical', () => {
    expect(HUSKY_HOOK).toContain('"$(basename "$0")"');
  });

  // ⚠️ Failing open is the deliberate trade — see install.ts. A regression here would
  //   make every commit in an uninstalled checkout fail on module resolution.
  test('exits 0 when the runner is absent rather than blocking the commit', () => {
    expect(HUSKY_HOOK).toContain('exit 0');
  });

  test('says a hook is not the gate', () => {
    expect(HUSKY_HOOK).toContain('--no-verify');
    expect(HUSKY_HOOK).toContain('required checks on main stay the gate');
  });
});

describe('installHooks', () => {
  test('writes both hooks, executable, with identical content', async () => {
    const dir = await scratch({ name: 'probe' });
    try {
      const written = await installHooks(dir);
      expect(written).toEqual(['.husky/pre-commit', '.husky/pre-push']);

      for (const name of HOOK_NAMES) {
        const path = join(dir, '.husky', name);
        expect(await Bun.file(path).text()).toBe(HUSKY_HOOK);
        expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('problemsInHooks', () => {
  test('reports a project that has adopted nothing', async () => {
    const dir = await scratch({ name: 'probe' });
    try {
      const problems = await problemsInHooks(dir);
      expect(problems.some((p) => p.includes('prepare'))).toBe(true);
      expect(problems.some((p) => p.includes('devDependency'))).toBe(true);
      expect(problems.filter((p) => p.includes('missing')).length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('is empty once prepare, husky and both wrappers are in place', async () => {
    const dir = await scratch({
      name: 'probe',
      scripts: { prepare: 'husky' },
      devDependencies: { husky: '9.1.7' },
    });
    try {
      await installHooks(dir);
      expect(await problemsInHooks(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ⛔ This is the whole point of owning the text centrally: a repo that edits its copy
  //   is drift, and drift that nothing reports is how fourteen copies happen.
  test('reports an edited wrapper as drift', async () => {
    const dir = await scratch({
      name: 'probe',
      scripts: { prepare: 'husky' },
      devDependencies: { husky: '9.1.7' },
    });
    try {
      await installHooks(dir);
      await Bun.write(join(dir, '.husky/pre-push'), `${HUSKY_HOOK}echo "local tweak"\n`);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('.husky/pre-push');
      expect(problems[0]).toContain('differs');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
