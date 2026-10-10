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
import * as Cause from 'effect/Cause';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from '../talos/cluster-adapter.ts';
import { UIDS, config, helmRow, session, vault } from '../talos/cluster-adapter.fixtures.ts';
import { fakeApiServer } from '../talos/fake-apiserver.ts';
import { type FakeHandler, fakeSpawner } from '../talos/fake-process.ts';
import {
  HELM_READ_TIMEOUT,
  HELM_RECONCILE_TIMEOUT,
  KubernetesReadyBadDuration,
  boundedHelmChartProvider,
  isBoundedHelmChartProvider,
} from './index.ts';
import { parseGoDuration } from './ready.ts';
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

test('the deadlines are pinned: reconcile 5m0s, read 1m, and they parse as such', async () => {
  expect(HELM_RECONCILE_TIMEOUT).toBe('5m0s');
  expect(HELM_READ_TIMEOUT).toBe('1m0s');
  const ms = (v: string) =>
    Effect.runPromise(parseGoDuration('x', v)).then((d) => Duration.toMillis(d));
  expect(await ms(HELM_RECONCILE_TIMEOUT)).toBe(300_000);
  expect(await ms(HELM_READ_TIMEOUT)).toBe(60_000);
});

test('a malformed deadline dies at layer build naming Kubernetes.HelmChart and the field', async () => {
  const dies = async (reconcileTimeout: string, readTimeout: string) => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* Provider.Provider<HelmChart>(HelmChart.Type);
      }).pipe(
        Effect.provide(
          Layer.provideMerge(boundedHelmChartProvider(reconcileTimeout, readTimeout), services),
        ),
      ) as Effect.Effect<unknown>,
    );
    return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
  };
  const reconcileBad = await dies('soon', '1m0s');
  expect(reconcileBad).toBeInstanceOf(KubernetesReadyBadDuration);
  expect((reconcileBad as Error).message).toBe(
    "Kubernetes.HelmChart: reconcileTimeout 'soon' is not a duration like 10m0s",
  );
  const readBad = await dies('5m0s', '0s');
  expect((readBad as Error).message).toBe(
    "Kubernetes.HelmChart: readTimeout '0s' is not a duration like 10m0s",
  );
});

test('an apiserver refusal passes through body-free (the needle never leaves)', async () => {
  const needle = 'NEEDLE-secret-body-9f3a';
  const api = fakeApiServer(UIDS, [], {
    [`PATCH ${HOST}${NS_PATH}`]: { body: { message: needle }, status: 422 },
  });
  try {
    const failure = await run(boundedHelmChartProvider(), (s) => reconcile(s).pipe(Effect.flip));
    expect(failure).toMatchObject({ _tag: 'KubernetesReadyApiError', statusCode: 422 });
    expect(String(failure)).not.toContain(needle);
    expect(JSON.stringify(failure)).not.toContain(needle);
    expect((failure as Error).message).toBe(
      `Kubernetes.Ready: PATCH ${NS_PATH}?fieldManager=alchemy&force=true responded 422`,
    );
  } finally {
    api.restore();
  }
});

test('isBoundedHelmChartProvider is true for the wrapper and false for upstream', async () => {
  const [bounded, upstream] = await Promise.all([
    run(boundedHelmChartProvider(), (s) => Effect.succeed(s)),
    run(HelmChartProvider(), (s) => Effect.succeed(s)),
  ]);
  expect(isBoundedHelmChartProvider(bounded)).toBe(true);
  expect(isBoundedHelmChartProvider(upstream)).toBe(false);
  expect(isBoundedHelmChartProvider(undefined)).toBe(false);
  expect(isBoundedHelmChartProvider({ ...bounded })).toBe(false);
});

test('merged beside Kubernetes.providers() the engine-resolved service enforces the deadline', async () => {
  const layer = Layer.mergeAll(Kubernetes.providers(), boundedHelmChartProvider('1s', '1h'));
  const api = fakeApiServer(UIDS, [], { [`PATCH ${HOST}${NS_PATH}`]: { hang: true } });
  try {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const registered = yield* Provider.tryFindProviderRegistrationByType<HelmChart>(
          HelmChart.Type,
        );
        if (Option.isNone(registered)) return yield* Effect.die('no registration');
        const service = registered.value as unknown as Service;
        const failure = yield* reconcile(service).pipe(Effect.flip);
        return { failure, marked: isBoundedHelmChartProvider(service) };
      }).pipe(
        Effect.provide(Layer.provideMerge(layer, Layer.merge(services, stack))),
      ) as Effect.Effect<{ failure: unknown; marked: boolean }>,
    );
    expect(found.marked).toBe(true);
    expect(found.failure).toBeInstanceOf(KubernetesReconcileTimeout);
  } finally {
    api.restore();
  }
});
