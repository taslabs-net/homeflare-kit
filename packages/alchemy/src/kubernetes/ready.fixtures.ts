/**
 * Shared harness for the `HomeFlare.Kubernetes.Ready` tests: the REAL `talos-openbao` adapter over a
 * fake `bao` and the fake apiserver (`talos/fake-apiserver.ts`), so uid proof, `readObject` and the
 * TLS-free request path all run for real. Nothing leaves the process.
 */
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as TestClock from 'effect/testing/TestClock';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from '../talos/cluster-adapter.ts';
import { UIDS, config, vault } from '../talos/cluster-adapter.fixtures.ts';
import { type FakeHandler, fakeSpawner } from '../talos/fake-process.ts';
import { type FakeObject, fakeApiServer } from '../talos/fake-apiserver.ts';
import type { ReadyCheck } from './ready-checks.ts';

export const HOST = 'c1.cluster.invalid';
export const connection = talosOpenBaoConnection('uid-c1');

export const DS_PATH = `/apis/apps/v1/namespaces/kube-system/daemonsets/cilium`;
export const DEP_PATH = `/apis/apps/v1/namespaces/kube-system/deployments/cilium-operator`;
export const CRD_PATH = `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/x.cilium.io`;

export const dsCheck: ReadyCheck = { kind: 'DaemonSet', name: 'cilium', namespace: 'kube-system' };
export const depCheck: ReadyCheck = {
  kind: 'Deployment',
  name: 'cilium-operator',
  namespace: 'kube-system',
};
export const crdCheck: ReadyCheck = { kind: 'CustomResourceDefinition', name: 'x.cilium.io' };

export const readyDs = {
  metadata: { generation: 2 },
  status: {
    desiredNumberScheduled: 3,
    numberAvailable: 3,
    numberReady: 3,
    observedGeneration: 2,
    updatedNumberScheduled: 3,
  },
};
export const readyDep = {
  metadata: { generation: 4 },
  spec: { replicas: 2 },
  status: { availableReplicas: 2, observedGeneration: 4, replicas: 2, updatedReplicas: 2 },
};
export const readyCrd = { status: { conditions: [{ status: 'True', type: 'Established' }] } };

export const get = (path: string) => `GET ${HOST}${path}`;

/**
 * Run `effect` against the fake cluster. `objects` is the live table: a test may mutate it from
 * inside `effect`. The fake `https` module is restored on every exit path.
 */
export const withCluster = async <A, E>(
  objects: Record<string, FakeObject>,
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | never>,
  handler: FakeHandler = vault,
) => {
  const api = fakeApiServer(UIDS, [], objects);
  const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(handler));
  try {
    const layer = Layer.mergeAll(TalosOpenBaoAdapter(config).pipe(Layer.provide(spawner)), spawner);
    return await Effect.runPromise(
      effect.pipe(Effect.provide(layer), Effect.provide(TestClock.layer())) as Effect.Effect<A, E>,
    );
  } finally {
    api.restore();
  }
};

/** Drive TestClock until `effect` settles (virtual seconds, no real waiting). */
export const driven = <A, E, R>(effect: Effect.Effect<A, E, R>, seconds = 1000) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(effect));
    for (let i = 0; i < seconds; i++) {
      yield* Effect.yieldNow;
      yield* TestClock.adjust('1 second');
    }
    return yield* Fiber.join(fiber);
  });
