/**
 * `talos-openbao` connect refusals that must happen BEFORE any vault read: a legacy `auth.cluster`
 * row, no uid, a uid no entry is pinned to, and two entries pinned to one uid. Fake `bao` only; the
 * `calls` list proves the vault was never spawned.
 */
import type { Connection } from 'alchemy/Kubernetes/Connection';
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
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

test('the missing-uid remedy says to pin a literal, not wire ClusterIdentity (fails on 19502c6)', async () => {
  const noUid = { auth: { kind: 'talos-openbao' } } as Connection;
  const message = await run(
    connectTalosOpenBao(config, noUid).pipe(
      Effect.catchTag('TalosClusterIdentityMissing', (error) => Effect.succeed(error.message)),
    ),
  );
  expect(message).toContain('pin the uid');
  expect(message).not.toContain('its `connection`');
});

test('a connection with no auth block is refused as a typed failure, not a raw TypeError', async () => {
  const calls: FakeCall[] = [];
  const noAuth = { endpoint: 'https://example.invalid' } as Connection;
  expect(await refusedWith(connectTalosOpenBao(config, noAuth), calls)).toBe(
    'TalosClusterIdentityMissing',
  );
  expect(calls).toEqual([]);
});

test('a connection that is itself undefined or null is refused as a typed failure (fails on a7668f7: the whole-connection destructure threw)', async () => {
  const calls: FakeCall[] = [];
  for (const absent of [undefined, null]) {
    expect(
      await refusedWith(connectTalosOpenBao(config, absent as unknown as Connection), calls),
    ).toBe('TalosClusterIdentityMissing');
  }
  expect(calls).toEqual([]);
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
