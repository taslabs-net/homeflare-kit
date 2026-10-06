/**
 * `bao` vetting (PR 355 red team, round 1): `bao` fetches the cluster credentials, so it must be
 * resolved and vetted exactly like `talosctl` before any environment reaches it. A fake `bao` in a
 * group/world-writable PATH folder (umask 002, the round-10 incident) must be refused, never
 * launched. Fails on a084e18, where `readKvValue`/`writeKvValue` spawned a bare `bao` from PATH
 * with no vetting.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { readKvValue } from './credentials.ts';
import { writeKvValue } from './credentials-write.ts';
import { type FakeCall, fakeSpawner } from './fake-process.ts';

/**
 * Run `effect` with a fake `bao` planted in a 775 PATH folder prepended to the real PATH, capture
 * every spawn the fake spawner saw, and restore PATH when done. Returns the failure text.
 */
const withFakeBaoIn775 = async (
  effect: Effect.Effect<unknown, Error, ChildProcessSpawner.ChildProcessSpawner>,
): Promise<{ failure: string; calls: FakeCall[]; options: unknown[] }> => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-bao-vet-'));
  const open = join(dir, 'open');
  mkdirSync(open);
  writeFileSync(join(open, 'bao'), '#!/bin/sh\n', { mode: 0o755 });
  chmodSync(join(open, 'bao'), 0o755);
  chmodSync(open, 0o775); // group-writable, like a umask-002 checkout
  const savedPath = process.env['PATH'];
  process.env['PATH'] = `${realpathSync(open)}:${savedPath ?? ''}`;
  const calls: FakeCall[] = [];
  const options: unknown[] = [];
  try {
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.provideService(
          effect,
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make((cmd) => {
            if (cmd._tag === 'StandardCommand') options.push(cmd.options);
            return fakeSpawner(() => ({}), calls).spawn(cmd);
          }),
        ),
      ),
    ).then((e) => String(e));
    return { failure, calls, options };
  } finally {
    if (savedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = savedPath;
    rmSync(dir, { force: true, recursive: true });
  }
};

test('a fake bao in a group/world-writable PATH folder is refused before any env reaches it', async () => {
  const { failure, calls } = await withFakeBaoIn775(
    readKvValue('talos-c1', 'kubeconfig', ['kubeconfig', 'config']),
  );
  expect(failure).toContain('writable directory');
  // ⛔ The refusal happens before the spawn, so the fake `bao` never ran and never saw an env.
  expect(calls).toEqual([]);
});

test('writeKvValue vets bao the same way and passes a minimal env with extendEnv off', async () => {
  const { failure, calls } = await withFakeBaoIn775(
    writeKvValue('talos-c1', 'kubeconfig', 'kubeconfig', 'secret-body'),
  );
  expect(failure).toContain('writable directory');
  expect(calls).toEqual([]);
});

test('a vetted bao gets baoEnv with extendEnv off and forceKillAfter set', async () => {
  // Uses the committed stub `bao` (fake-process.ts), which passes vetting, and observes the spawn.
  const options: Array<{
    env?: Record<string, string | undefined> | undefined;
    extendEnv?: boolean | undefined;
    forceKillAfter?: unknown;
  }> = [];
  const outcome = await Effect.runPromise(
    Effect.provideService(
      writeKvValue('talos-c1', 'kubeconfig', 'kubeconfig', 'secret-body'),
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((cmd) => {
        if (cmd._tag === 'StandardCommand') options.push(cmd.options);
        return fakeSpawner(() => ({}), []).spawn(cmd);
      }),
    ),
  );
  expect(outcome).toBeUndefined();
  expect(options.length).toBe(1);
  const opts = options[0];
  expect(opts?.extendEnv).toBe(false);
  expect(opts?.forceKillAfter).toBeDefined();
  expect(Object.keys(opts?.env ?? {})).toContain('BAO_ADDR');
  expect(Object.keys(opts?.env ?? {})).toContain('BAO_TOKEN');
});
