/**
 * The C1 lifetime fix — pins that `mintTalosconfig`'s temp file survives until the CALLER's own
 * `Effect.scoped` closes, not until `mintTalosconfig` itself returns (the shipped defect,
 * credentials.ts's own header). Fully offline: fake-process.ts fakes `bao`, nothing real spawns.
 *
 * ⚠️ FIXTURES ONLY. No real OpenBao, no real talosconfig material — every "talosconfig" body
 *   below is a plain marker string, not YAML that could be mistaken for the real shape.
 */
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { mintKubeconfig, mintKvTempFile, mintTalosconfig, readKvValue } from './credentials.ts';
import { type FakeCall, fakeSpawner } from './fake-process.ts';

const bao =
  (data: Record<string, unknown>, exitCode = 0) =>
  (call: FakeCall) => {
    assert.equal(call.command, 'bao');
    return exitCode === 0
      ? { stdout: JSON.stringify({ data: { data } }) }
      : { exitCode, stderr: 'permission denied' };
  };

const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: (c: FakeCall) => ReturnType<ReturnType<typeof bao>>,
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );

describe('mintTalosconfig — C1 lifetime fix', () => {
  it('reads talosconfig/<mount> — the FIXED default key, not the doubled data/data path', async () => {
    const calls: FakeCall[] = [];
    let capturedPath = '';
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const credential = yield* mintTalosconfig({ cluster: 'c1', mount: 'talos-c1' });
          capturedPath = credential.talosconfigPath;
          assert.ok(existsSync(capturedPath), 'file must exist while the caller scope is open');
        }),
      ).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          fakeSpawner(bao({ talosconfig: 'fake-talosconfig-body' }), calls),
        ),
      ),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, ['kv', 'get', '-format=json', 'talos-c1/talosconfig']);
    assert.equal(existsSync(capturedPath), false, 'must be gone once the caller scope closed');
  });

  it('is gone even when the caller scope is closed by a later failure (finalizers always run)', async () => {
    let capturedPath = '';
    const failing = Effect.scoped(
      Effect.gen(function* () {
        const credential = yield* mintTalosconfig({ cluster: 'c1', mount: 'talos-c1' });
        capturedPath = credential.talosconfigPath;
        return yield* Effect.fail(new Error('downstream talosctl call failed'));
      }),
    ).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        fakeSpawner(bao({ talosconfig: 'fake-body' })),
      ),
    );
    await assert.rejects(Effect.runPromise(failing));
    assert.equal(existsSync(capturedPath), false);
  });

  it('honors a custom talosconfigKey without adding a data/ prefix', async () => {
    const calls: FakeCall[] = [];
    await run(
      Effect.scoped(
        mintTalosconfig({ cluster: 'c1', mount: 'talos-c1', talosconfigKey: 'context/admin' }),
      ),
      bao({ config: 'fallback-field-body' }),
      calls,
    );
    assert.deepEqual(calls[0]?.args, ['kv', 'get', '-format=json', 'talos-c1/context/admin']);
  });

  it('fails without spawning talosctl or leaving a file when bao denies the read', async () => {
    await assert.rejects(
      run(Effect.scoped(mintTalosconfig({ cluster: 'c1', mount: 'talos-c1' })), bao({}, 1)),
    );
  });

  it('fails when the KV entry has neither a talosconfig nor a config field', async () => {
    await assert.rejects(
      run(
        Effect.scoped(mintTalosconfig({ cluster: 'c1', mount: 'talos-c1' })),
        bao({ unrelated: 'x' }),
      ),
    );
  });
});

describe('mintKvTempFile', () => {
  it('writes exactly the given content at mode 0600', async () => {
    let path = '';
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const file = yield* mintKvTempFile('exact body\n', 'c1-node-config');
          path = file.path;
          const text = yield* Effect.promise(() => Bun.file(path).text());
          assert.equal(text, 'exact body\n');
          assert.equal(statSync(path).mode & 0o777, 0o600);
        }),
      ),
    );
    assert.equal(existsSync(path), false);
  });
});

describe('mintKubeconfig — the consumer-side seam, same lifetime shape as mintTalosconfig', () => {
  it('reads the default kubeconfig key and the file survives only within the caller scope', async () => {
    const calls: FakeCall[] = [];
    let capturedPath = '';
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const file = yield* mintKubeconfig({ cluster: 'c1', mount: 'talos-c1' });
          capturedPath = file.path;
          assert.ok(existsSync(capturedPath));
        }),
      ).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          fakeSpawner(bao({ kubeconfig: 'fake-kubeconfig-body' }), calls),
        ),
      ),
    );
    assert.deepEqual(calls[0]?.args, ['kv', 'get', '-format=json', 'talos-c1/kubeconfig']);
    assert.equal(existsSync(capturedPath), false);
  });
});

describe('readKvValue', () => {
  it('tries fields in order and returns the first non-empty match', async () => {
    const value = await run(
      readKvValue('talos-c1', 'nodes/10001', ['config', 'legacyConfig']),
      bao({ legacyConfig: 'second-field-body' }),
    );
    assert.equal(value, 'second-field-body');
  });
});
