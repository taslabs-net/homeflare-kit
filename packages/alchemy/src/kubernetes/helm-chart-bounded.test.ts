/**
 * `boundedHelmChartProvider` THROUGH upstream's real `HelmChartProvider`, the real `talos-openbao`
 * adapter, a fake `bao`, a fake `helm` and the fake apiserver (`talos/fake-apiserver.ts`): a PATCH
 * that never answers must fail reconcile with the typed timeout, a fast apply must return what
 * upstream returns, and the layer must be the DIRECT `Provider(HelmChart)` registration.
 * Deadlines are real (1s): the fake request holds no timer, so nothing stays blocked.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { HelmChart, HelmChartProvider } from 'alchemy/Kubernetes/HelmChart';
import * as Kubernetes from 'alchemy/Kubernetes';
import * as Provider from 'alchemy/Provider';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from '../talos/cluster-adapter.ts';
import { UIDS, config, helmRow, session, vault } from '../talos/cluster-adapter.fixtures.ts';
import { fakeApiServer } from '../talos/fake-apiserver.ts';
import { type FakeHandler, fakeSpawner } from '../talos/fake-process.ts';
import { HELM_READ_TIMEOUT, HELM_RECONCILE_TIMEOUT, boundedHelmChartProvider } from './index.ts';
import { KubernetesReconcileTimeout } from './helm-chart-bounded.ts';

const HOST = 'c1.cluster.invalid';
const NS_PATH = '/api/v1/namespaces/ns-c1';
const RENDERED = 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ns-c1\n';

// The fake `helm` answers the render; every other command is the fake vault's.
const handler: FakeHandler = (call) =>
  call.args[0] === 'template' ? { stdout: RENDERED } : vault(call);
const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(handler));
const services = Layer.mergeAll(
  NodeServices.layer,
  TalosOpenBaoAdapter(config).pipe(Layer.provide(spawner)),
  // ⚠️ Last, so the fake spawner shadows NodeServices' real one: no real `helm` or `bao` runs.
  spawner,
);

// Kubernetes.providers() builds workload providers that read the ambient Stack at build time.
const stack = Layer.mergeAll(
  Layer.succeed(Stack, { name: 'bounded-test', stage: 'test' } as never),
  Layer.succeed(AlchemyContext, {
    adopt: false,
    dev: false,
    dotAlchemy: join(tmpdir(), 'hf-bounded'),
  }),
);

const CHART = 'oci://example.invalid/chart';
const news = {
  chart: CHART,
  cluster: talosOpenBaoConnection('uid-c1'),
  releaseName: 'r',
} as never;

type Service = Provider.ProviderService<HelmChart>;
const run = <A, E>(
  // The requirements (spawner, FileSystem, Stack...) are all supplied by `services`/`stack` below.
  provider: Layer.Layer<Provider.Provider<HelmChart>, never, unknown>,
  body: (s: Service) => Effect.Effect<A, E, never>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* body((yield* Provider.Provider<HelmChart>(HelmChart.Type)) as Service);
    }).pipe(Effect.provide(Layer.provideMerge(provider, services))) as Effect.Effect<A, E>,
  );
const reconcile = (s: Service) =>
  s.reconcile({ id: 'cilium', news, output: undefined, session } as never);

test('a PATCH that never answers fails reconcile with the typed timeout inside the deadline', async () => {
  const api = fakeApiServer(UIDS, [], { [`PATCH ${HOST}${NS_PATH}`]: { hang: true } });
  const started = Date.now();
  try {
    // ★ Distinct deadlines: swapping the two (reconcile on the read bound) would wait an hour.
    const failure = await run(boundedHelmChartProvider('1s', '1h'), (s) =>
      reconcile(s).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(KubernetesReconcileTimeout);
    expect(failure).toMatchObject({
      _tag: 'KubernetesReconcileTimeout',
      id: 'cilium',
      operation: 'reconcile',
      seconds: 1,
    });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(api.seen).toContain(`PATCH ${HOST}${NS_PATH}`);
    // The message names the row and the seconds, nothing the server said.
    expect(String(failure)).toBe(
      'KubernetesReconcileTimeout: Kubernetes.HelmChart cilium: reconcile did not finish within 1s (the apiserver stopped answering)',
    );
  } finally {
    api.restore();
  }
});

test('a read whose identity GET never answers fails with the typed timeout on the read bound', async () => {
  const api = fakeApiServer(UIDS, [HOST]);
  try {
    const failure = await run(boundedHelmChartProvider('1h', '1s'), (s) =>
      (s.read as NonNullable<Service['read']>)
        .call(s, {
          id: 'cilium',
          olds: undefined,
          output: helmRow({ uid: 'uid-c1' }),
          session,
        } as never)
        .pipe(Effect.flip),
    );
    expect(failure).toMatchObject({
      _tag: 'KubernetesReconcileTimeout',
      operation: 'read',
      seconds: 1,
    });
  } finally {
    api.restore();
  }
});

test('a fast apply returns exactly the attributes upstream returns', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const bounded = await run(boundedHelmChartProvider(), reconcile);
    const upstream = await run(HelmChartProvider(), reconcile);
    expect(bounded).toEqual(upstream);
    expect(bounded).toMatchObject({ releaseName: 'r', namespace: 'default', chart: CHART });
    expect(api.seen.some((call) => call.startsWith('PATCH '))).toBe(true);
  } finally {
    api.restore();
  }
});

test('stables, aliases, diff and delete are upstream by spread', async () => {
  const [bounded, upstream] = await Promise.all([
    run(boundedHelmChartProvider(), (s) => Effect.succeed(s)),
    run(HelmChartProvider(), (s) => Effect.succeed(s)),
  ]);
  expect(bounded.stables).toEqual(upstream.stables);
  expect(bounded.aliases).toEqual(upstream.aliases);
  expect(Object.keys(bounded).sort()).toEqual(Object.keys(upstream).sort());
  expect(typeof bounded.diff).toBe('function');
  expect(typeof bounded.delete).toBe('function');
});

test('the deadlines are pinned: reconcile 5m0s, read 1m', () => {
  expect(HELM_RECONCILE_TIMEOUT).toBe('5m0s');
  expect(HELM_READ_TIMEOUT).toBe('1m0s');
});

test('a malformed deadline dies at layer build instead of dropping the bound', async () => {
  await expect(run(boundedHelmChartProvider('soon'), (s) => Effect.succeed(s))).rejects.toThrow();
});

test('merged beside Kubernetes.providers() the wrapper is the registered Provider(HelmChart)', async () => {
  const layer = Layer.mergeAll(Kubernetes.providers(), boundedHelmChartProvider());
  const found = await Effect.runPromise(
    Effect.gen(function* () {
      const direct = yield* Provider.Provider<HelmChart>(HelmChart.Type);
      const registered = yield* Provider.tryFindProviderRegistrationByType<HelmChart>(
        HelmChart.Type,
      );
      const collection = yield* Kubernetes.Providers;
      return { collection: collection.get(HelmChart.Type), direct, registered };
    }).pipe(
      Effect.provide(Layer.provideMerge(layer, Layer.merge(services, stack))),
    ) as Effect.Effect<{
      collection: unknown;
      direct: unknown;
      registered: Option.Option<unknown>;
    }>,
  );
  expect(Option.isSome(found.registered)).toBe(true);
  expect(Option.getOrUndefined(found.registered)).toBe(found.direct);
  // ★ Upstream's own registration is still in the collection, and is NOT the one that resolves.
  expect(found.collection).toBeDefined();
  expect(found.collection).not.toBe(found.direct);
});
