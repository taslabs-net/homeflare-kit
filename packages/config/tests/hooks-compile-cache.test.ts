/**
 * npm enables Node's module compile cache itself at startup (measured 2026-10-06, npm 12.0.2 on
 * node v22.23.2: `TMPDIR=$T npm --version` leaves `$T/node-compile-cache`). The lane runner sets
 * NODE_DISABLE_COMPILE_CACHE=1 so the temp guard does not refuse an npm repo's push for a
 * directory its tests never created. This runs a real `npm`, not a stand-in.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { runInTmp } from '../src/hooks/tmp-guard.ts';

test('a real `npm --version` lane leaves nothing in the guarded TMPDIR', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-compile-cache-'));
  try {
    const run = await runInTmp('npm --version >/dev/null', root);
    expect(run.code).toBe(0);
    expect(run.leaks).toEqual([]);
    expect(run.cleanupError).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the guard stays strict: a lane that makes its own temp entry still leaks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hf-compile-cache-'));
  try {
    const run = await runInTmp('mkdir "$TMPDIR/own-AbCdEf"', root);
    expect(run.leaks).toEqual([{ prefix: 'own-', count: 1 }]);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
