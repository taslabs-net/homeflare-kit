/**
 * `Talos.ClusterHealth` hands its `connection` to workloads through `cluster: health`, so an
 * Output there reintroduces the unresolved-uid hole `talosOpenBaoConnection` closes. `diff` still
 * sees the Input, so that is where the refusal happens. Offline: fake-process.ts fakes everything.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import { diffClusterHealth } from './talos-cluster-health.ts';

const connection = talosOpenBaoConnection('uid-c1');
const prior = {
  connection,
  controlPlaneNodes: '198.51.100.10',
  healthy: true,
  workerNodes: '',
};
const base = {
  controlPlaneNodes: ['198.51.100.10'],
  target: { cluster: 'c1', mount: 'talos-c1' },
};

const diffWith = (given: unknown, calls: FakeCall[]) =>
  Effect.runPromise(
    Effect.provideService(
      diffClusterHealth({ ...base, connection: given } as never, prior),
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(
        () => ({ stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) }),
        calls,
      ),
    ),
  );

describe('diffClusterHealth — literal connection', () => {
  it('plans noop for a literal connection (the guard does not refuse good input)', async () => {
    const calls: FakeCall[] = [];
    assert.equal((await diffWith(connection, calls))?.action, 'noop');
  });

  it('refuses an Output uid before any vault or talosctl call', async () => {
    const calls: FakeCall[] = [];
    const uid = Output.literal('uid-c1');
    await assert.rejects(
      diffWith({ auth: { kind: 'talos-openbao', uid } }, calls),
      (error: unknown) => String(error).includes('literal string'),
    );
    assert.deepEqual(calls, []);
  });

  it('refuses a connection that is itself an Output', async () => {
    const calls: FakeCall[] = [];
    await assert.rejects(diffWith(Output.literal(connection), calls));
    assert.deepEqual(calls, []);
  });

  it('refuses a stock kubeconfig connection at diff time (never reaches $KUBECONFIG)', async () => {
    const calls: FakeCall[] = [];
    await assert.rejects(
      diffWith({ auth: { kind: 'kubeconfig', context: 'admin@hf-c1' } }, calls),
      (error: unknown) => String(error).includes('literal string'),
    );
    assert.deepEqual(calls, []);
  });
});
