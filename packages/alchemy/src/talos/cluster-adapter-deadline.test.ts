/**
 * One deadline over the whole `talos-openbao` connect path, with a REAL child process: a `bao`
 * that never exits must fail connect with `TalosOpenBaoConnectTimeout` and must not outlive it.
 * The fake `bao` is a throwaway executable in `os.tmpdir()`, removed on every exit path; PATH is
 * the only process-global touched and is restored.
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

test('a bao that never exits fails connect with the typed timeout and the child is killed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-deadline-'));
  const pidFile = join(dir, 'pid');
  const savedPath = process.env['PATH'];
  try {
    writeFileSync(
      join(dir, 'bao'),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    chmodSync(join(dir, 'bao'), 0o700);
    process.env['PATH'] = `${dir}:${savedPath ?? ''}`;
    const config = {
      c1: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
    };
    // ★ The production connect path with only the 10 s bound shortened, so the test is fast.
    const hung = connectTalosOpenBao(
      config,
      talosOpenBaoConnection('uid-c1'),
      Duration.millis(1500),
    );
    const failure = await Effect.runPromise(
      hung.pipe(Effect.flip, Effect.provide(NodeServices.layer)),
    );
    expect((failure as { _tag: string })._tag).toBe('TalosOpenBaoConnectTimeout');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    for (let i = 0; i < 40 && alive(pid); i++) await Bun.sleep(100);
    expect(alive(pid)).toBe(false);
  } finally {
    if (savedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = savedPath;
    rmSync(dir, { force: true, recursive: true });
  }
});
