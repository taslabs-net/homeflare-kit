/**
 * npm enables Node's module compile cache itself at startup (measured 2026-10-06, npm 12.0.2 on
 * node v22.23.2: `TMPDIR=$T npm --version` leaves `$T/node-compile-cache`). The lane runner sets
 * NODE_DISABLE_COMPILE_CACHE=1 so the temp guard does not refuse an npm repo's push for a
 * directory its tests never created. This runs a real `npm`, not a stand-in.
 *
 * ⚠️ The runner's own environment may already carry NODE_DISABLE_COMPILE_CACHE or
 *   NODE_COMPILE_CACHE, and then a real `npm` leaves nothing with or without the change. So the
 *   precondition is proven first, with both removed, and the lane runs with both removed too.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { runLane } from '../src/hooks/report.ts';
import { runInTmp } from '../src/hooks/tmp-guard.ts';

const CACHE_VARS = ['NODE_DISABLE_COMPILE_CACHE', 'NODE_COMPILE_CACHE'] as const;

/** Run `body` with both compile-cache variables absent from process.env, then restore them. */
async function withoutCacheVars<T>(body: () => Promise<T>): Promise<T> {
  const saved = CACHE_VARS.map((name) => [name, process.env[name]] as const);
  for (const name of CACHE_VARS) delete process.env[name];
  try {
    return await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hf-compile-cache-'));
}

test('precondition: an unmodified `npm --version` creates node-compile-cache', async () => {
  const root = await scratch();
  const tmp = await scratch();
  try {
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp };
    for (const name of CACHE_VARS) delete env[name];
    const proc = Bun.spawn(['npm', '--version'], {
      cwd: root,
      env,
      stdout: 'ignore',
      stderr: 'inherit',
    });
    expect(await proc.exited).toBe(0);
    expect(
      (await readdir(tmp)).some((name) => name.startsWith('node-compile-cache')),
      'precondition broken: npm no longer leaves node-compile-cache, so the test below proves nothing',
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
});

test('a real `npm --version` lane leaves nothing in the guarded TMPDIR', async () => {
  const root = await scratch();
  try {
    const run = await withoutCacheVars(() => runInTmp('npm --version >/dev/null', root));
    expect(run.code).toBe(0);
    expect(run.leaks).toEqual([]);
    expect(run.cleanupError).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runLane defaults NODE_DISABLE_COMPILE_CACHE=1 and a caller `extra` overrides it', async () => {
  const root = await scratch();
  try {
    await withoutCacheVars(async () => {
      expect(await runLane('test "$NODE_DISABLE_COMPILE_CACHE" = 1', root)).toBe(0);
      const extra = { NODE_DISABLE_COMPILE_CACHE: '0' };
      expect(await runLane('test "$NODE_DISABLE_COMPILE_CACHE" = 0', root, extra)).toBe(0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the guard stays strict: a lane that makes its own temp entry still leaks', async () => {
  const root = await scratch();
  try {
    const run = await runInTmp('mkdir "$TMPDIR/own-AbCdEf"', root);
    expect(run.leaks).toEqual([{ prefix: 'own-', count: 1 }]);
    // The guard directory is what cleanup removes; the scratch root was never its business.
    await expect(readdir(run.removed)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
