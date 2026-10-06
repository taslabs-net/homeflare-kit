/**
 * `Talos.ClusterHealth` — no swallowed transport errors (K-talos-first-boot). Fully offline:
 * fake-process.ts fakes `bao`/`talosctl`, nothing real spawns.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import {
  diffClusterHealth,
  readClusterHealth,
  reconcileClusterHealth,
} from './talos-cluster-health.ts';

const TARGET = { cluster: 'c1', mount: 'talos-c1' };
const connection = talosOpenBaoConnection('uid-c1');
const props = () => ({ connection, controlPlaneNodes: ['198.51.100.10'], target: TARGET });
const prior = (healthy: boolean) => ({
  connection,
  controlPlaneNodes: '198.51.100.10',
  healthy,
  workerNodes: '',
});

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

const baoOk = (call: FakeCall) =>
  call.command === 'bao'
    ? { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) }
    : undefined;

/** `talosctl health` ran and reported unhealthy — the one case this family may call "not healthy". */
const unhealthy = (call: FakeCall) =>
  baoOk(call) ?? { exitCode: 1, stderr: 'kube-proxy not ready' };

/** `talosctl health` ran and reported healthy. */
const healthy = (call: FakeCall) => baoOk(call) ?? {};

/** `bao` itself fails — a transport/credential problem, not a cluster-health verdict. */
const vaultDown = (call: FakeCall) =>
  call.command === 'bao' ? { exitCode: 1, stderr: 'permission denied' } : {};

describe('readClusterHealth', () => {
  it('reports healthy:false when talosctl health ran and exited non-zero', async () => {
    const result = await run(readClusterHealth(props()), unhealthy);
    assert.equal(result.healthy, false);
  });

  it('reports healthy:true when talosctl health exits zero', async () => {
    const result = await run(readClusterHealth(props()), healthy);
    assert.equal(result.healthy, true);
    assert.deepEqual(result.connection, connection);
  });

  it('propagates a vault/transport failure instead of reporting healthy:false', async () => {
    await assert.rejects(
      run(readClusterHealth(props()), vaultDown),
      (error: unknown) => error instanceof Error && error.message.includes('permission denied'),
    );
  });
});

describe('diffClusterHealth', () => {
  it('plans update when the cluster genuinely reports unhealthy', async () => {
    const result = await run(diffClusterHealth(props(), prior(false)), unhealthy);
    assert.equal(result?.action, 'update');
  });

  it('propagates a vault/transport failure rather than planning update silently', async () => {
    await assert.rejects(run(diffClusterHealth(props(), prior(false)), vaultDown));
  });

  it('plans noop when the cluster is healthy and the connection is unchanged', async () => {
    const result = await run(diffClusterHealth(props(), prior(true)), healthy);
    assert.equal(result?.action, 'noop');
  });

  it('plans update when the cluster is healthy but the connection changed', async () => {
    const drifted = talosOpenBaoConnection('uid-other');
    const result = await run(
      diffClusterHealth(props(), { ...prior(true), connection: drifted }),
      healthy,
    );
    assert.equal(result?.action, 'update');
  });

  it('plans update when only the cluster uid changed (a real move)', async () => {
    const moved = talosOpenBaoConnection('uid-c2');
    const result = await run(
      diffClusterHealth(props(), { ...prior(true), connection: moved }),
      healthy,
    );
    assert.equal(result?.action, 'update');
  });

  it('plans update, not a throw, for a row saved before `connection` existed', async () => {
    const { connection: _dropped, ...old } = prior(true);
    const result = await run(
      diffClusterHealth(props(), old as unknown as ReturnType<typeof prior>),
      healthy,
    );
    assert.equal(result?.action, 'update');
  });
});

describe('diffClusterHealth — a non-literal connection is a TYPED failure', () => {
  it('fails (flip would reject on a defect) with TalosUidNotLiteral for an Output uid', async () => {
    const output = Output.literal('uid-c1') as unknown as string;
    const bad = { ...props(), connection: { auth: { kind: 'talos-openbao', uid: output } } };
    const error = await run(Effect.flip(diffClusterHealth(bad as never, prior(true))), healthy);
    assert.equal((error as { _tag: string })._tag, 'TalosUidNotLiteral');
  });
});

describe('check — I1 fix: --nodes names ONE contact node, not the whole cluster', () => {
  it('targets only the first control-plane node with --nodes/--endpoints, but lists all of them under --control-plane-nodes', async () => {
    const calls: FakeCall[] = [];
    await run(
      readClusterHealth({
        connection,
        controlPlaneNodes: ['198.51.100.10', '198.51.100.11', '198.51.100.12'],
        target: TARGET,
      }),
      healthy,
      calls,
    );
    const talosctlCall = calls.find((c) => c.command === 'talosctl');
    assert.ok(talosctlCall);
    // ⛔ talosctl v1.13.8, measured: `health --nodes <ip1>,<ip2>` exits with "command \"health\" is
    // not supported with multiple nodes" — exactly one contact node may ever reach --nodes.
    const nodesIdx = talosctlCall.args.indexOf('--nodes');
    assert.equal(talosctlCall.args[nodesIdx + 1], '198.51.100.10');
    const endpointsIdx = talosctlCall.args.indexOf('--endpoints');
    assert.equal(talosctlCall.args[endpointsIdx + 1], '198.51.100.10');
    const cpIdx = talosctlCall.args.indexOf('--control-plane-nodes');
    assert.equal(talosctlCall.args[cpIdx + 1], '198.51.100.10,198.51.100.11,198.51.100.12');
  });

  it('fails closed instead of spawning talosctl when controlPlaneNodes is empty', async () => {
    await assert.rejects(
      run(readClusterHealth({ connection, controlPlaneNodes: [], target: TARGET }), healthy),
      (error: unknown) =>
        error instanceof Error && error.message.includes('controlPlaneNodes is empty'),
    );
  });
});

describe('reconcileClusterHealth', () => {
  it('wraps a TalosError with a "cluster not healthy" message', async () => {
    await assert.rejects(
      run(reconcileClusterHealth(props()), unhealthy),
      (error: unknown) => error instanceof Error && error.message.includes('cluster not healthy'),
    );
  });

  it('propagates a vault/transport failure WITHOUT the "cluster not healthy" mislabel', async () => {
    await assert.rejects(
      run(reconcileClusterHealth(props()), vaultDown),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('permission denied') &&
        !error.message.includes('cluster not healthy'),
    );
  });
});
