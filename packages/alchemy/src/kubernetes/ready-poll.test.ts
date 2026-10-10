/**
 * Error classes of the poll and of a single pass, through the real adapter and `readObject` over
 * the fake apiserver. Time is TestClock's: the 10 m deadline costs no real seconds.
 */
import { expect, test } from 'bun:test';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Cause from 'effect/Cause';
import { connectCluster } from 'alchemy/Kubernetes/internal/client';
import { type FakeObject } from '../talos/fake-apiserver.ts';
import { isNotFound, pass, poll, transientOf } from './ready-poll.ts';
import {
  CRD_PATH,
  DEP_PATH,
  DS_PATH,
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

const WAIT = Duration.minutes(10);
const EVERY = Duration.seconds(10);
const checks = [dsCheck, depCheck, crdCheck];
const allReady = (): Record<string, FakeObject> => ({
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
});

/** The failure of a polled run, or `ok`. */
const pollOutcome = (objects: Record<string, FakeObject>, mutate?: () => void) =>
  withCluster(
    objects,
    driven(
      Effect.gen(function* () {
        mutate?.();
        yield* poll(() => connectCluster(connection), checks, WAIT, EVERY);
      }),
    ).pipe(
      Effect.map((exit) =>
        Exit.isSuccess(exit)
          ? { ok: true }
          : { error: Cause.squash(exit.cause) as { _tag?: string } },
      ),
    ),
  );

test('an all-ready cluster passes on the first look', async () => {
  const outcome = await pollOutcome(allReady());
  expect(outcome).toEqual({ ok: true });
});

test('404 in either shape is pending: the poll times out naming the keys, no transient', async () => {
  const objects = allReady();
  objects[get(CRD_PATH)] = { body: { kind: 'Status' }, status: 404 };
  const outcome = (await pollOutcome(objects)) as { error: Record<string, unknown> };
  expect(outcome.error['_tag']).toBe('KubernetesReadyTimeout');
  expect(outcome.error['failing']).toEqual(['CustomResourceDefinition/x.cilium.io']);
  expect(outcome.error['seconds']).toBe(600);
  expect(outcome.error['lastTransient']).toBeUndefined();
  // the second shape (a later alchemy raises KubernetesNotFound), matched by tag string alone
  expect(isNotFound({ _tag: 'KubernetesNotFound' })).toBe(true);
  expect(isNotFound({ _tag: 'KubernetesApiError', statusCode: 404 })).toBe(true);
  expect(isNotFound({ _tag: 'KubernetesApiError', statusCode: 403 })).toBe(false);
  expect(isNotFound(new Error('404'))).toBe(false);
});

for (const [name, entry, expected] of [
  ['5xx', { status: 503, body: { secret: 'x' } }, { status: 503, tag: 'KubernetesApiError' }],
  ['429', { status: 429 }, { status: 429, tag: 'KubernetesApiError' }],
  ['a per-GET timeout', { hang: true }, { tag: 'KubernetesReadyGetTimeout' }],
  // ★ upstream retries a transport error every 5 s up to 8 times, about 40 s
  //   (`client.ts:158-161,166-172`), longer than the 5 s per-GET bound, so through the fake socket it
  //   surfaces as the GET timeout; the classifier below is what a plain Error from a later upstream
  //   (no retry) would reach.
  ['a transport error', { error: 'ECONNREFUSED 10.0.0.1' }, { tag: 'KubernetesReadyGetTimeout' }],
] as const) {
  test(`${name} is pending in a poll and named as lastTransient (tag + status, no body)`, async () => {
    const objects = allReady();
    objects[get(DEP_PATH)] = entry;
    const outcome = (await pollOutcome(objects)) as { error: Record<string, unknown> };
    expect(outcome.error['_tag']).toBe('KubernetesReadyTimeout');
    // ⚠️ after a timed-out GET the rest of the pass is pending unread (socket rationing)
    const unread = 'tag' in expected && expected.tag === 'KubernetesReadyGetTimeout';
    expect(outcome.error['failing']).toEqual([
      'Deployment/kube-system/cilium-operator',
      ...(unread ? ['CustomResourceDefinition/x.cilium.io'] : []),
    ]);
    expect(outcome.error['lastTransient']).toEqual(expected);
    expect(JSON.stringify(outcome.error)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(outcome.error)).not.toContain('secret');
  });
}

test('transientOf: tolerable classes only; 4xx, tagged adapter errors and non-errors are not', () => {
  expect(transientOf(new Error('Failed Kubernetes GET /x: ECONNRESET'))).toEqual({
    tag: 'TransportError',
  });
  expect(transientOf({ _tag: 'KubernetesApiError', statusCode: 502 })).toEqual({
    status: 502,
    tag: 'KubernetesApiError',
  });
  expect(transientOf({ _tag: 'KubernetesApiError', statusCode: 429 })?.status).toBe(429);
  for (const error of [
    { _tag: 'KubernetesApiError', statusCode: 401 },
    { _tag: 'KubernetesApiError', statusCode: 403 },
    { _tag: 'KubernetesApiError', statusCode: 404 },
    { _tag: 'TalosVaultKeyMissing' },
    // an untagged Error that is not upstream's transport wrapper is a defect (path-builder throw)
    new Error('Kubernetes object apps/v1/Deployment/x requires a namespace'),
    new Error('ECONNRESET'),
    Object.assign(new Error('tagged'), { _tag: 'TalosOpenBaoConnectTimeout' }),
    'a string',
  ]) {
    expect(transientOf(error)).toBeUndefined();
  }
});

test('the poll recovers when a transient clears (the cluster answers on a later pass)', async () => {
  const objects = allReady();
  objects[get(DEP_PATH)] = { status: 503 };
  const outcome = await pollOutcome(objects, () => {
    // flip to ready after the first pass has looked: mutate on the live table
    setTimeout(() => (objects[get(DEP_PATH)] = { body: readyDep }), 0);
  });
  // the timer runs on real time; the poll sleeps virtual seconds, so the next pass sees it ready
  expect(outcome).toEqual({ ok: true });
});

for (const status of [401, 403, 400, 409]) {
  test(`${status} propagates from a poll instead of waiting out the deadline`, async () => {
    const objects = allReady();
    objects[get(DS_PATH)] = { status, body: { message: 'nope' } };
    const outcome = (await pollOutcome(objects)) as { error: Record<string, unknown> };
    expect(outcome.error['_tag']).toBe('KubernetesReadyApiError');
    expect(outcome.error['statusCode']).toBe(status);
  });
}

test('ProgressDeadlineExceeded ends the poll with the typed failure, immediately', async () => {
  const objects = allReady();
  objects[get(DEP_PATH)] = {
    body: {
      ...readyDep,
      status: {
        ...readyDep.status,
        conditions: [{ reason: 'ProgressDeadlineExceeded', type: 'Progressing' }],
      },
    },
  };
  const outcome = (await pollOutcome(objects)) as { error: Record<string, unknown> };
  expect(outcome.error['_tag']).toBe('KubernetesRolloutFailed');
  expect(outcome.error['check']).toBe('Deployment/kube-system/cilium-operator');
});

test('a single pass tolerates 404 only: 5xx, 429, timeout and transport errors propagate', async () => {
  const run = (entry: FakeObject) =>
    withCluster(
      { ...allReady(), [get(DEP_PATH)]: entry },
      driven(
        Effect.gen(function* () {
          const transport = yield* connectCluster(connection);
          return yield* pass(transport, checks, false);
        }),
        30,
      ).pipe(
        Effect.map((exit) =>
          Exit.isSuccess(exit)
            ? exit.value
            : { error: Cause.squash(exit.cause) as { _tag?: string } },
        ),
      ),
    );
  expect(await run({ status: 404 })).toMatchObject({
    failed: [],
    pending: ['Deployment/kube-system/cilium-operator'],
  });
  for (const [entry, tag] of [
    [{ status: 503 }, 'KubernetesReadyApiError'],
    [{ status: 429 }, 'KubernetesReadyApiError'],
    [{ hang: true }, 'KubernetesReadyGetTimeout'],
  ] as const) {
    expect(((await run(entry)) as { error: { _tag: string } }).error._tag).toBe(tag);
  }
  expect(((await run({ error: 'ECONNRESET' })) as { error: unknown }).error).toBeInstanceOf(Error);
});
