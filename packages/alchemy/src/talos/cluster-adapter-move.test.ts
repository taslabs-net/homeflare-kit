/**
 * Round-2 findings, each THROUGH the real engine or providers with the fake `bao` and fake
 * apiserver: (1) a workload moved between two PINNED literal uids plans a replace and never
 * reconciles the old cluster's objects on the new one, and an Output uid is refused at declare
 * time; (2) `Drift.repair` cannot launder a moved `Talos.ClusterIdentity`; (3) a silent apiserver
 * fails closed with a typed timeout instead of hanging connect.
 */
import { expect, test } from 'bun:test';
import { Manifest } from 'alchemy/Kubernetes/Manifest';
import * as Output from 'alchemy/Output';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { engineOver } from '../verify/fake-engine.ts';
import { connectTalosOpenBao, talosOpenBaoConnection } from './cluster-adapter.ts';
import { UIDS, config, failure, providerLayer, vault } from './cluster-adapter.fixtures.ts';
import { readClusterUid } from './cluster-identity.ts';
import { openTransport } from './cluster-transport.ts';
import { fakeApiServer } from './fake-apiserver.ts';
import { fakeSpawner } from './fake-process.ts';
import { TalosClusterIdentity, TalosClusterIdentityProvider } from './talos-cluster-identity.ts';

const namespace = (uid: string) =>
  Manifest('ns', {
    cluster: talosOpenBaoConnection(uid),
    manifest: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'ns-shared' } },
  });
const declare = (uid: string) =>
  Effect.gen(function* () {
    yield* namespace(uid);
  });
const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(vault));

test('a workload moved between two pinned uids is a replace; the old objects are never deleted on the new cluster', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const engine = engineOver(providerLayer(config));
    expect((await engine.deploy(declare('uid-c1')))['ns']).toBe('create');
    api.seen.length = 0;
    expect((await engine.deploy(declare('uid-c2')))['ns']).toBe('replace');
    const onC1 = api.seen.filter((call) => call.includes('c1.cluster.invalid'));
    const deletesOnC2 = api.seen.filter(
      (call) => call.startsWith('DELETE ') && call.includes('c2.cluster.invalid'),
    );
    // The new cluster is created on; the replaced generation is cleaned up on the OLD one.
    expect(api.seen.some((call) => call.startsWith('PATCH c2.cluster.invalid'))).toBe(true);
    expect(onC1.some((call) => call.startsWith('DELETE '))).toBe(true);
    expect(deletesOnC2).toEqual([]);
  } finally {
    api.restore();
  }
});

test('an Output uid is refused when the connection is declared', () => {
  const output = Output.literal('uid-c1') as unknown as string;
  expect(() => talosOpenBaoConnection(output)).toThrow('literal string');
});

test('Drift.repair on a moved Talos.ClusterIdentity fails with TalosClusterMoved and keeps the saved uid', async () => {
  const stack = Effect.gen(function* () {
    yield* TalosClusterIdentity('c1', {
      context: 'admin@c1',
      target: { cluster: 'c1', mount: 'talos-c1' },
    });
  });
  const engine = engineOver(Layer.mergeAll(TalosClusterIdentityProvider(), spawner));
  const first = fakeApiServer({ 'c1.cluster.invalid': 'uid-c1' });
  try {
    await engine.deploy(stack);
  } finally {
    first.restore();
  }
  const moved = fakeApiServer({ 'c1.cluster.invalid': 'uid-c2' });
  try {
    const repaired = await engine.repair(stack).then(
      (rows) => JSON.stringify(rows),
      (error: unknown) => String(error),
    );
    expect(repaired).not.toContain('"repaired"');
    expect(engine.stored()).toContain('uid-c1');
    expect(engine.stored()).not.toContain('uid-c2');
  } finally {
    moved.restore();
  }
});

test('a silent apiserver fails closed with TalosClusterIdentityTimeout', async () => {
  const api = fakeApiServer(UIDS, ['c1.cluster.invalid']);
  try {
    const read = Effect.gen(function* () {
      const transport = yield* openTransport(config.c1);
      return yield* readClusterUid('c1', transport, Duration.millis(50));
    });
    const spawn = ChildProcessSpawner.ChildProcessSpawner;
    const message = await failure(() =>
      Effect.runPromise(Effect.provideService(read, spawn, fakeSpawner(vault))),
    );
    expect(message).toContain('TalosClusterIdentityTimeout');
    // The text names the identity read's own deadline inside the 10 s connect deadline.
    expect(message).toContain("the identity read's own deadline, inside the 10 s connect deadline");
  } finally {
    api.restore();
  }
});

test(
  'through connect, a silent apiserver fails with the identity timeout, not the outer deadline',
  async () => {
    // ⛔ The inner uid deadline (5 s) is shorter than the outer connect deadline (10 s), so a silent
    //   apiserver must be reported as TalosClusterIdentityTimeout, never swallowed into
    //   TalosOpenBaoConnectTimeout (red team, PR 355 — on a084e18 the inner deadline never fired).
    const api = fakeApiServer(UIDS, ['c1.cluster.invalid']);
    try {
      const message = await failure(() =>
        Effect.runPromise(
          Effect.provideService(
            connectTalosOpenBao(config, talosOpenBaoConnection('uid-c1')),
            ChildProcessSpawner.ChildProcessSpawner,
            fakeSpawner(vault),
          ),
        ),
      );
      expect(message).toContain('TalosClusterIdentityTimeout');
      expect(message).not.toContain('TalosOpenBaoConnectTimeout');
    } finally {
      api.restore();
    }
  },
  { timeout: 15000 },
);
