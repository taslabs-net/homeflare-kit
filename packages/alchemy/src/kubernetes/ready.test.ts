/**
 * The `HomeFlare.Kubernetes.Ready` handlers through the real adapter: read, reconcile, diff, and the
 * failures that must propagate. Fake `bao` and fake apiserver only; time is TestClock's.
 */
import { expect, test } from 'bun:test';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Cause from 'effect/Cause';
import * as Output from 'alchemy/Output';
import { talosOpenBaoConnection } from '../talos/cluster-adapter.ts';
import type { FakeObject } from '../talos/fake-apiserver.ts';
import { diffReady, parseGoDuration, readReady, reconcileReady } from './ready.ts';
import { KubernetesReady } from './ready.ts';
import {
  CRD_PATH,
  DEP_PATH,
  DS_PATH,
  HOST,
  connection,
  crdCheck,
  depCheck,
  driven,
  dsCheck,
  get,
  readyCrd,
  readyDep,
  readyDs,
  withCluster,
} from './ready.fixtures.ts';

const checks = [dsCheck, depCheck, crdCheck];
const props = (extra: object = {}) => ({ checks, connection, ...extra });
const allReady = (): Record<string, FakeObject> => ({
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
});
const settle = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  driven(effect, 700).pipe(
    Effect.map((exit) =>
      Exit.isSuccess(exit)
        ? { ok: exit.value }
        : { error: Cause.squash(exit.cause) as { _tag?: string } },
    ),
  );
const csv = checks
  .map((c) =>
    c.kind === 'CustomResourceDefinition'
      ? `${c.kind}/${c.name}`
      : `${c.kind}/${c.namespace}/${c.name}`,
  )
  .join(',');
const prior = (ready = true) => ({ checks: csv, connection, ready });

test('read: ready:true when every check passes, false when one is pending (404 included)', async () => {
  expect((await withCluster(allReady(), readReady(props()))).ready).toBe(true);
  const stale = {
    ...allReady(),
    [get(DS_PATH)]: { body: { ...readyDs, status: { ...readyDs.status, observedGeneration: 1 } } },
  };
  expect((await withCluster(stale, readReady(props()))).ready).toBe(false);
  const missing = { ...allReady(), [get(CRD_PATH)]: { status: 404 } };
  expect((await withCluster(missing, readReady(props()))).ready).toBe(false);
});

test('read propagates 5xx, 429 and a hung GET (only a poll tolerates them)', async () => {
  for (const [entry, tag] of [
    [{ status: 503 }, 'KubernetesReadyApiError'],
    [{ status: 429 }, 'KubernetesReadyApiError'],
    [{ hang: true }, 'KubernetesReadyGetTimeout'],
  ] as const) {
    const out = await withCluster(
      { ...allReady(), [get(DEP_PATH)]: entry },
      settle(readReady(props())),
    );
    expect((out as { error: { _tag: string } }).error._tag).toBe(tag);
  }
});

test('reconcile: all ready returns ready attributes; a never-ready check times out with its key', async () => {
  const ok = await withCluster(allReady(), settle(reconcileReady(props())));
  expect(ok).toEqual({ ok: { checks: csv, connection, ready: true } });
  const bad = {
    ...allReady(),
    [get(DS_PATH)]: {
      body: { ...readyDs, status: { ...readyDs.status, updatedNumberScheduled: 0 } },
    },
  };
  const out = (await withCluster(
    bad,
    settle(reconcileReady(props({ waitTimeout: '30s', pollInterval: '5s' }))),
  )) as {
    error: Record<string, unknown>;
  };
  expect(out.error['_tag']).toBe('KubernetesReadyTimeout');
  expect(out.error['failing']).toEqual(['DaemonSet/kube-system/cilium']);
  expect(out.error['seconds']).toBe(30);
});

test('401 and 403 propagate through read and reconcile, never become pending', async () => {
  for (const status of [401, 403]) {
    const objects = { ...allReady(), [get(DS_PATH)]: { status } };
    for (const run of [readReady(props()), reconcileReady(props())]) {
      const out = (await withCluster(objects, settle(run))) as {
        error: { _tag: string; statusCode: number };
      };
      expect(out.error).toMatchObject({ _tag: 'KubernetesReadyApiError', statusCode: status });
    }
  }
});

test('a bao failure propagates (a vault outage is not "not ready yet")', async () => {
  const down = () => ({ exitCode: 2, stderr: 'permission denied' });
  for (const run of [readReady(props()), reconcileReady(props())]) {
    const out = (await withCluster(allReady(), settle(run), down)) as { error: Error };
    expect(String(out.error)).not.toContain('KubernetesReadyTimeout');
    expect(out.error).toBeDefined();
  }
});

test('a uid mismatch is the typed identity error, before any check is read', async () => {
  const objects = allReady();
  const other = { ...props(), connection: talosOpenBaoConnection('uid-c1') };
  // the apiserver answers a different kube-system uid than the pin
  const out = await withCluster(
    {
      ...objects,
      [`GET ${HOST}/api/v1/namespaces/kube-system`]: { body: { metadata: { uid: 'uid-other' } } },
    },
    settle(readReady(other)),
  );
  expect((out as { error: { _tag: string } }).error._tag).toBe('TalosClusterIdentityMismatch');
});

test('diff: noop when ready and unchanged; update when pending, changed checks or connection', async () => {
  const run = (
    objects: Record<string, FakeObject>,
    output: ReturnType<typeof prior> | undefined,
    news = props(),
  ) => withCluster(objects, diffReady(news as never, output));
  expect(await run(allReady(), prior())).toEqual({ action: 'noop' });
  expect(await run(allReady(), undefined)).toBeUndefined();
  expect(await run(allReady(), { ...prior(), checks: 'DaemonSet/kube-system/other' })).toEqual({
    action: 'update',
  });
  expect(
    await run(allReady(), { ...prior(), connection: talosOpenBaoConnection('uid-c2') }),
  ).toEqual({ action: 'update' });
  const { connection: _gone, ...legacy } = prior();
  expect(await run(allReady(), legacy as never)).toEqual({ action: 'update' });
  const pending = { ...allReady(), [get(CRD_PATH)]: { status: 404 } };
  expect(await run(pending, prior())).toEqual({ action: 'update' });
});

test('diff refuses a non-literal connection with the typed error, and so does declaration', async () => {
  const bad = {
    ...props(),
    connection: {
      auth: { kind: 'talos-openbao', uid: Output.literal('uid-c1') as unknown as string },
    },
  };
  const error = await withCluster(allReady(), Effect.flip(diffReady(bad as never, prior())));
  expect((error as { _tag: string })._tag).toBe('TalosUidNotLiteral');
  const declared = await Effect.runPromise(
    Effect.flip(KubernetesReady('x', bad as never) as never),
  );
  expect((declared as { _tag: string })._tag).toBe('TalosUidNotLiteral');
});

test('durations: Go style accepted, anything else typed-refused', async () => {
  const ms = (v: string) => Effect.runPromise(parseGoDuration('waitTimeout', v));
  expect(Duration.toMillis(await ms('10m0s'))).toBe(600_000);
  expect(Duration.toMillis(await ms('1h30m'))).toBe(5_400_000);
  for (const bad of ['', '10', 'ten minutes', '10m0', '1.5s']) {
    const e = await Effect.runPromise(Effect.flip(parseGoDuration('waitTimeout', bad)));
    expect(e._tag).toBe('KubernetesReadyBadDuration');
  }
});
