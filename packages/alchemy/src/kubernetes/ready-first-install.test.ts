/**
 * The FIRST install of a `HomeFlare.Kubernetes.Ready` row (round 1, findings 2 and 4): Alchemy runs
 * a deferred adoption `read` before `reconcile`, and `reconcile` connects (the cluster-identity GET)
 * before its first look. An apiserver restarting under a CNI rollout must not fail either.
 */
import { expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import type { FakeObject } from '../talos/fake-apiserver.ts';
import { readHandler, readReady, reconcileReady } from './ready.ts';
import {
  CRD_PATH,
  DEP_PATH,
  DS_PATH,
  HOST,
  IDENTITY_PATH,
  checksOf,
  connection,
  driven,
  get,
  readyCrd,
  readyDep,
  readyDs,
  sequence,
  withCluster,
} from './ready.fixtures.ts';

const props = { checks: checksOf(), connection, pollInterval: '5s', waitTimeout: '5m' };
const allReady = (): Record<string, FakeObject> => ({
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
});
const identity = `GET ${HOST}${IDENTITY_PATH}`;
const settle = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  driven(effect, 400).pipe(
    Effect.map((exit) =>
      Exit.isSuccess(exit)
        ? { ok: exit.value }
        : { error: Cause.squash(exit.cause) as { _tag?: string } },
    ),
  );

test('read on a first create (no prior output) adopts nothing and touches no cluster', async () => {
  // every GET would fail: a read that looked would propagate it
  const down = { ...allReady(), [identity]: { status: 503 } };
  const out = await withCluster(down, settle(readHandler({ olds: props, output: undefined })));
  expect(out).toEqual({ ok: undefined });
});

test('read of an existing row still looks (the live pass is what diff/refresh rely on)', async () => {
  const out = await withCluster(
    allReady(),
    readHandler({ olds: props, output: { checks: '', connection, ready: false } }),
  );
  expect((out as { ready: boolean }).ready).toBe(true);
});

for (const [name, first] of [
  ['a 503', { status: 503, body: { message: 'secret-needle' } }],
  ['a 429', { status: 429 }],
  ['a hung GET', { hang: true }],
] as const) {
  test(`first create: ${name} on the identity GET is tolerated, then the gate opens`, async () => {
    const objects = sequence(allReady(), identity, [first, first, undefined]);
    expect(await withCluster(objects, settle(reconcileReady(props)))).toMatchObject({
      ok: { ready: true },
    });
  });

  test(`first create: ${name} right after apply (first check GET) is tolerated`, async () => {
    const objects = sequence(allReady(), get(DEP_PATH), [first, first, { body: readyDep }]);
    expect(await withCluster(objects, settle(reconcileReady(props)))).toMatchObject({
      ok: { ready: true },
    });
  });
}

test('an identity GET that never recovers times out as the gate, naming the transient', async () => {
  const out = (await withCluster(
    { ...allReady(), [identity]: { status: 503 } },
    settle(reconcileReady({ ...props, waitTimeout: '30s' })),
  )) as { error: { _tag: string; lastTransient?: unknown; failing: string[] } };
  expect(out.error._tag).toBe('KubernetesReadyTimeout');
  expect(out.error.lastTransient).toMatchObject({ status: 503, tag: 'KubernetesApiError' });
  expect(out.error.failing).toHaveLength(3);
});

test('401/403 on the identity GET propagate at once, scrubbed of the response body', async () => {
  for (const status of [401, 403]) {
    const out = (await withCluster(
      { ...allReady(), [identity]: { body: { message: 'identity-body-needle' }, status } },
      settle(reconcileReady(props)),
    )) as { error: { _tag: string; statusCode: number } };
    expect(out.error).toMatchObject({ _tag: 'KubernetesReadyApiError', statusCode: status });
    expect(JSON.stringify(out.error) + String(out.error)).not.toContain('identity-body-needle');
  }
});

test('a one-pass read/diff connect scrubs the identity GET body too (5xx and 4xx)', async () => {
  for (const status of [503, 401, 403]) {
    const out = (await withCluster(
      { ...allReady(), [identity]: { body: { message: 'identity-body-needle' }, status } },
      settle(readReady(props)),
    )) as { error: { _tag: string; statusCode: number } };
    expect(out.error).toMatchObject({ _tag: 'KubernetesReadyApiError', statusCode: status });
    expect(JSON.stringify(out.error) + String(out.error)).not.toContain('identity-body-needle');
  }
});

test('a vault failure and a uid mismatch still propagate at once (never waited out)', async () => {
  const down = () => ({ exitCode: 2, stderr: 'permission denied' });
  const out = (await withCluster(allReady(), settle(reconcileReady(props)), down)) as {
    error: { _tag?: string };
  };
  expect(out.error._tag).not.toBe('KubernetesReadyTimeout');
  const other = {
    ...allReady(),
    [identity]: { body: { metadata: { uid: 'uid-other' } } },
  };
  const mismatch = (await withCluster(other, settle(reconcileReady(props)))) as {
    error: { _tag: string };
  };
  expect(mismatch.error._tag).toBe('TalosClusterIdentityMismatch');
});
