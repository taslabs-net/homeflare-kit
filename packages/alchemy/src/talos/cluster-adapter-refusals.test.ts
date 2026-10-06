/**
 * `talos-openbao` connect refusals that must happen BEFORE any vault read: a legacy `auth.cluster`
 * row, no uid, a uid no entry is pinned to, and two entries pinned to one uid. Fake `bao` only; the
 * `calls` list proves the vault was never spawned.
 */
import type { Connection } from 'alchemy/Kubernetes/Connection';
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { connectTalosOpenBao, talosOpenBaoConnection } from './cluster-adapter.ts';
import { type FakeCall, fakeSpawner } from './fake-process.ts';

const config = {
  c1: { context: 'admin@hf-c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
};
const connection = talosOpenBaoConnection('uid-c1');

const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(() => ({ stdout: '{}' }), calls),
    ),
  );

const refusedWith = (
  effect: Effect.Effect<unknown, unknown, ChildProcessSpawner.ChildProcessSpawner>,
  calls: FakeCall[],
) =>
  run(
    effect.pipe(
      Effect.catch((error) =>
        Effect.succeed(error instanceof Error && '_tag' in error ? String(error._tag) : 'untagged'),
      ),
    ),
    calls,
  );

test('a legacy auth.cluster row is refused with no vault read and a remedy', async () => {
  const calls: FakeCall[] = [];
  const legacy = { auth: { kind: 'talos-openbao', cluster: 'c1', uid: 'uid-c1' } } as Connection;
  expect(await refusedWith(connectTalosOpenBao(config, legacy), calls)).toBe(
    'TalosOpenBaoLegacyAuth',
  );
  expect(calls).toEqual([]);
  const message = await run(
    connectTalosOpenBao(config, legacy).pipe(
      Effect.catchTag('TalosOpenBaoLegacyAuth', (error) => Effect.succeed(error.message)),
    ),
  );
  expect(message).toContain('edit the saved state');
});

test('no uid, an unknown uid and an ambiguous pin are refused before any vault read', async () => {
  const calls: FakeCall[] = [];
  const noUid = { auth: { kind: 'talos-openbao' } } as Connection;
  expect(await refusedWith(connectTalosOpenBao(config, noUid), calls)).toBe(
    'TalosClusterIdentityMissing',
  );
  expect(
    await refusedWith(connectTalosOpenBao(config, talosOpenBaoConnection('uid-x')), calls),
  ).toBe('TalosOpenBaoUnknownCluster');
  const twice = { ...config, c1b: { ...config.c1 } };
  expect(await refusedWith(connectTalosOpenBao(twice, connection), calls)).toBe(
    'TalosOpenBaoAmbiguousUid',
  );
  expect(calls).toEqual([]);
});
