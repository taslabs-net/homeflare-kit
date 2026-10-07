/**
 * The version probe's deadline against a REAL hanging child: the claim in talosctl.ts that a timed-out
 * probe kills the child (and its process group) is proved here with `process.kill(pid, 0)`, not with a
 * spawner that never starts anything. The script lives in a private os.tmpdir() directory removed on
 * every exit path, and sleeps 60 s so a surviving child is unmistakable.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { trustBoundaryForTests } from './trust-boundary.seam.ts';
import { TalosBinaryRefused, talosctl } from './talosctl.ts';

const dir = mkdtempSync(join(tmpdir(), 'hf-probe-kill-'));
chmodSync(dir, 0o755);
trustBoundaryForTests(dir);
afterAll(() => rmSync(dir, { force: true, recursive: true }));

const pidFile = join(dir, 'pids');
const script = join(dir, 'talosctl');
// The shell and its `sleep` grandchild both record their pid: the grandchild only dies if the whole
// process group is killed, not just the direct child.
writeFileSync(script, `#!/bin/sh\nsleep 60 &\necho "$$ $!" > '${pidFile}'\nwait\n`, {
  mode: 0o755,
});
chmodSync(script, 0o755);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

test('a probe that hangs is refused and its real child and process group are gone', async () => {
  const outcome = await Effect.runPromise(
    Effect.flip(
      talosctl(['version'], {
        binary: script,
        talosconfigPath: 'unused.yaml',
        versionProbeTimeout: '1 seconds',
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );
  expect(outcome).toBeInstanceOf(TalosBinaryRefused);
  const pids = readFileSync(pidFile, 'utf8').trim().split(' ').map(Number);
  expect(pids).toHaveLength(2);
  // SIGKILL follows SIGTERM after `forceKillAfter` (1 s), so allow it to land.
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await Bun.sleep(100);
  expect(pids.map(alive)).toEqual([false, false]);
});
