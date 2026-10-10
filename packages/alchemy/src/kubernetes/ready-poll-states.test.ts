/**
 * Round 1, findings 3 and 7 through the poll: what the timeout reports, defects that propagate, a
 * cleared transient that is not blamed, and the strategy failure's typed reason.
 */
import { expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { connectCluster } from 'alchemy/Kubernetes/internal/client';
import type { FakeObject } from '../talos/fake-apiserver.ts';
import { poll } from './ready-poll.ts';
import {
  CRD_PATH,
  DEP_PATH,
  DS_PATH,
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

const WAIT = Duration.minutes(10);
const EVERY = Duration.seconds(10);
const allReady = (): Record<string, FakeObject> => ({
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
});
const run = (objects: Record<string, FakeObject>, checks = checksOf()) =>
  withCluster(
    objects,
    driven(poll(() => connectCluster(connection), checks, WAIT, EVERY)).pipe(
      Effect.map((exit) => (Exit.isSuccess(exit) ? 'ok' : Cause.squash(exit.cause))),
    ),
  ) as Promise<Record<string, unknown> & Error>;

test('the timeout records per key what the last pass saw: notFound, or the counts (no body)', async () => {
  const objects = allReady();
  objects[get(CRD_PATH)] = { body: { message: 'state-body-needle' }, status: 404 };
  const stuck = { ...readyDs, status: { ...readyDs.status, updatedNumberScheduled: 1 } };
  objects[get(DS_PATH)] = { body: stuck };
  const error = await run(objects);
  expect(error['_tag']).toBe('KubernetesReadyTimeout');
  expect(error['states']).toEqual({
    'CustomResourceDefinition/x.cilium.io': { notFound: true },
    'DaemonSet/kube-system/cilium': {
      counts: {
        desiredNumberScheduled: 3,
        generation: 2,
        numberAvailable: 3,
        observedGeneration: 2,
        updatedNumberScheduled: 1,
      },
    },
  });
  expect(error.message).toContain('x.cilium.io (not found)');
  expect(error.message).toContain('updatedNumberScheduled=1');
  expect(JSON.stringify(error) + error.message).not.toContain('state-body-needle');
});

test('an untagged defect (upstream path-builder throw) propagates instead of waiting ten minutes', async () => {
  // a namespaced kind with an empty namespace makes upstream's path builder throw a plain Error
  const bad = [{ kind: 'Deployment', name: 'x', namespace: '' }] as never;
  const error = await run(allReady(), bad);
  expect(error).toBeInstanceOf(Error);
  expect(error['_tag']).toBeUndefined();
  expect(error.message).toContain('requires a namespace');
});

test('a transient that has cleared is not blamed by the timeout', async () => {
  const stuck = { ...readyDs, status: { ...readyDs.status, updatedNumberScheduled: 0 } };
  // 503 on the first look, then answered (and never ready)
  const flaky = sequence(allReady(), get(DS_PATH), [{ status: 503 }, { body: stuck }]);
  const error = await run(flaky);
  expect(error['_tag']).toBe('KubernetesReadyTimeout');
  expect(error['lastTransient']).toBeUndefined();
});

test('OnDelete ends the poll with KubernetesRolloutFailed and its own reason', async () => {
  const objects = allReady();
  objects[get(DS_PATH)] = { body: { ...readyDs, spec: { updateStrategy: { type: 'OnDelete' } } } };
  const error = await run(objects);
  expect(error['_tag']).toBe('KubernetesRolloutFailed');
  expect(error['reason']).toBe('UpdateStrategyNotRollingUpdate');
  expect(error['check']).toBe('DaemonSet/kube-system/cilium');
});
