/**
 * `credentials-write.ts` — offline, fake `bao`, no real process ever spawns. Fixtures only.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { reservedTempPath, writeKvValue } from './credentials-write.ts';
import { type FakeCall, fakeSpawner } from './fake-process.ts';

const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: (c: FakeCall) => { stdout?: string; stderr?: string; exitCode?: number },
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );

describe('writeKvValue', () => {
  it('sends the value on stdin, never in argv', async () => {
    const calls: FakeCall[] = [];
    await run(
      writeKvValue('talos-c1', 'kubeconfig', 'kubeconfig', 'super-secret-kubeconfig-body'),
      () => ({}),
      calls,
    );
    assert.equal(calls.length, 1);
    // ⛔ C2 (LAND red team): `=-`, never `=@-` — `@` means "read a file at this literal path",
    // which OpenBao's own CLI rejects (or, worse, silently reads a file named `-` if one exists).
    assert.deepEqual(calls[0]?.args, ['kv', 'put', 'talos-c1/kubeconfig', 'kubeconfig=-']);
    assert.equal(calls[0]?.stdin, 'super-secret-kubeconfig-body');
    // ⛔ THE POINT OF THE TEST: the value appears nowhere in argv.
    assert.ok(!calls[0]?.args.some((arg) => arg.includes('super-secret-kubeconfig-body')));
  });

  it('fails on a non-zero exit and never echoes stdin in the error', async () => {
    await assert.rejects(
      run(writeKvValue('talos-c1', 'kubeconfig', 'kubeconfig', 'secret-body'), () => ({
        exitCode: 2,
        stderr: 'permission denied',
      })),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('permission denied') &&
        !error.message.includes('secret-body'),
    );
  });
});

describe('reservedTempPath', () => {
  it('does not pre-create the file, and cleans up if something else wrote there', async () => {
    let path = '';
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reserved = yield* reservedTempPath('c1-node-kubeconfig-out');
          path = reserved.path;
          assert.equal(existsSync(path), false, 'nothing has written here yet');
          yield* Effect.promise(() =>
            Bun.write(path, 'written by the caller, like talosctl would'),
          );
          assert.ok(existsSync(path));
        }),
      ),
    );
    assert.equal(existsSync(path), false, 'must be gone once the caller scope closed');
  });

  it('two calls never collide on the same path', async () => {
    const [a, b] = await Effect.runPromise(
      Effect.scoped(Effect.all([reservedTempPath('same-label'), reservedTempPath('same-label')])),
    );
    assert.notEqual(a.path, b.path);
  });
});
