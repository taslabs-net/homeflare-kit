/**
 * One deadline over the whole `talos-openbao` connect path, with a REAL child process: a `bao`
 * that never exits, forks a sleeper, or ignores SIGTERM must fail connect with
 * `TalosOpenBaoConnectTimeout` and must not outlive it. The fake `bao` is a throwaway executable
 * in `os.tmpdir()`, removed on every exit path; PATH is the only process-global touched and is
 * restored.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import { connectTalosOpenBao, talosOpenBaoConnection } from './cluster-adapter.ts';
import './fake-process.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const settle = async (pid: number) => {
  for (let i = 0; i < 40 && alive(pid); i++) await Bun.sleep(100);
  return alive(pid);
};

const config = { c1: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' } };
const BOUND = Duration.millis(1500);
// `__DIR__` is declared at the top of each script (the child gets a minimal env, no process.env).
const recordPid = `require('node:fs').writeFileSync(__DIR__ + '/pid', String(process.pid));\n`;
const hang = 'setInterval(() => {}, 1000);\n';
// The sleeper is a node child of `bao`: only a group kill reaches it.
const forkSleeper = [
  'const sleeper = "require(\'node:fs\').writeFileSync(" + JSON.stringify(__DIR__ + "/grandchild")',
  '  + ", String(process.pid)); setInterval(() => {}, 1000)";',
  "require('node:child_process').spawn(process.execPath, ['-e', sleeper], { stdio: 'ignore' });",
  '',
].join('\n');

/**
 * Run the production connect path against a throwaway `bao` script on PATH, with only the bound
 * shortened. `pids` reads a pid file the script wrote, while the directory still exists.
 */
const connectAgainst = async (
  script: string,
  assert: (run: {
    failure: { _tag: string };
    elapsed: number;
    pid: (name: string) => number;
  }) => Promise<void>,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-deadline-'));
  const saved = { path: process.env['PATH'] };
  try {
    const header = `#!${process.execPath}\nconst __DIR__ = ${JSON.stringify(dir)};\n`;
    writeFileSync(join(dir, 'bao'), `${header}${script}`);
    chmodSync(join(dir, 'bao'), 0o700);
    process.env['PATH'] = `${dir}:${saved.path ?? ''}`;
    const started = Date.now();
    const failure = await Effect.runPromise(
      connectTalosOpenBao(config, talosOpenBaoConnection('uid-c1'), BOUND).pipe(
        Effect.flip,
        Effect.provide(NodeServices.layer),
      ),
    );
    await assert({
      elapsed: Date.now() - started,
      failure: failure as { _tag: string },
      pid: (name) => Number(readFileSync(join(dir, name), 'utf8')),
    });
  } finally {
    if (saved.path === undefined) delete process.env['PATH'];
    else process.env['PATH'] = saved.path;
    rmSync(dir, { force: true, recursive: true });
  }
};

test('a bao that never exits fails connect with the typed timeout and the child is killed', async () => {
  await connectAgainst(`${recordPid}${hang}`, async (run) => {
    expect(run.failure._tag).toBe('TalosOpenBaoConnectTimeout');
    expect(run.pid('pid')).toBeGreaterThan(0);
    expect(await settle(run.pid('pid'))).toBe(false);
  });
});

test('a bao that forks a sleeper leaves no grandchild alive after the timeout', async () => {
  // ⛔ Killing only the leader (the old `detached: false`) leaves the sleeper running.
  await connectAgainst(`${recordPid}${forkSleeper}${hang}`, async (run) => {
    expect(run.failure._tag).toBe('TalosOpenBaoConnectTimeout');
    await Bun.sleep(300);
    const grandchild = run.pid('grandchild');
    expect(grandchild).toBeGreaterThan(0);
    expect(await settle(grandchild)).toBe(false);
    expect(await settle(run.pid('pid'))).toBe(false);
  });
});

test('a bao that ignores SIGTERM still fails connect within the deadline plus ~2 s', async () => {
  // ⛔ Without `forceKillAfter` the finalizer waits on a leader that never exits.
  await connectAgainst(`${recordPid}process.on('SIGTERM', () => {});\n${hang}`, async (run) => {
    expect(run.failure._tag).toBe('TalosOpenBaoConnectTimeout');
    expect(run.elapsed).toBeLessThan(1500 + 2500);
    expect(await settle(run.pid('pid'))).toBe(false);
  });
});
