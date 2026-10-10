/** The rollout rules on literal bodies (kubectl `rollout_status.go`), no I/O. */
import { expect, test } from 'bun:test';
import { type ReadyCheck, checkKey, checksCsv, evaluate } from './ready-checks.ts';

const ds = (status: object, generation = 2, minReady?: number) => ({
  body: { metadata: { generation }, status },
  check: {
    kind: 'DaemonSet',
    name: 'cilium',
    namespace: 'kube-system',
    ...(minReady === undefined ? {} : { minReady }),
  } as ReadyCheck,
});
const dsVerdict = (status: object, generation?: number, minReady?: number) => {
  const { body, check } = ds(status, generation, minReady);
  return evaluate(check, body);
};
const fullDs = {
  desiredNumberScheduled: 3,
  numberAvailable: 3,
  numberReady: 3,
  observedGeneration: 2,
  updatedNumberScheduled: 3,
};

test('DaemonSet: ready only when the generation is seen and updated and available reach minReady', () => {
  expect(dsVerdict(fullDs)).toBe('ready');
  // stale generation, numberReady 3: the OLD pods look healthy while the new spec is unseen
  expect(dsVerdict({ ...fullDs, observedGeneration: 1 })).toBe('pending');
  // updated 0 with numberReady 3: nothing is on the new template yet
  expect(dsVerdict({ ...fullDs, updatedNumberScheduled: 0 })).toBe('pending');
  // numberAvailable below the bar although numberReady is 3
  expect(dsVerdict({ ...fullDs, numberAvailable: 1 })).toBe('pending');
});

test('DaemonSet: minReady 2 passes 2/3, minReady 3 does not, default is desiredNumberScheduled', () => {
  // all 3 on the new template, one down: 2 updated-and-available meets minReady 2
  const two = { ...fullDs, numberAvailable: 2, numberReady: 2 };
  expect(dsVerdict(two, 2, 2)).toBe('ready');
  expect(dsVerdict(two, 2, 3)).toBe('pending');
  expect(dsVerdict(two)).toBe('pending');
});

test('DaemonSet: a set that wants zero pods is not ready', () => {
  expect(dsVerdict({ desiredNumberScheduled: 0, observedGeneration: 2 })).toBe('pending');
  expect(dsVerdict({ observedGeneration: 2 }, 2, 0)).toBe('pending');
});

const dep: ReadyCheck = { kind: 'Deployment', name: 'cilium-operator', namespace: 'kube-system' };
const depBody = (status: object, replicas = 2, generation = 4) => ({
  metadata: { generation },
  spec: { replicas },
  status: { observedGeneration: 4, ...status },
});
const rolled = { availableReplicas: 2, replicas: 2, updatedReplicas: 2 };

test('Deployment: ready only on the full rollout counts', () => {
  expect(evaluate(dep, depBody(rolled))).toBe('ready');
  expect(evaluate(dep, depBody(rolled, 2, 5))).toBe('pending'); // generation not observed
  // Available with updatedReplicas < replicas: the old ReplicaSet still serves
  expect(evaluate(dep, depBody({ ...rolled, updatedReplicas: 1 }))).toBe('pending');
  // surplus old replicas still running: replicas != updatedReplicas
  expect(evaluate(dep, depBody({ ...rolled, replicas: 3 }))).toBe('pending');
  expect(evaluate(dep, depBody({ ...rolled, availableReplicas: 1 }))).toBe('pending');
  // scaled up to 2 but the controller has made only 1 (status is self-consistent at 1)
  const one = { availableReplicas: 1, replicas: 1, updatedReplicas: 1 };
  expect(evaluate(dep, depBody(one))).toBe('pending');
});

test('Deployment: ProgressDeadlineExceeded is failed, but only for the generation the controller saw', () => {
  const exceeded = { conditions: [{ reason: 'ProgressDeadlineExceeded', type: 'Progressing' }] };
  expect(evaluate(dep, depBody({ ...rolled, ...exceeded }))).toBe('failed');
  expect(evaluate(dep, depBody({ ...exceeded, observedGeneration: 3 }))).toBe('pending');
  const fine = { conditions: [{ reason: 'NewReplicaSetAvailable', type: 'Progressing' }] };
  expect(evaluate(dep, depBody({ ...rolled, ...fine }))).toBe('ready');
});

test('CRD: ready only when Established is True', () => {
  const crd: ReadyCheck = { kind: 'CustomResourceDefinition', name: 'ciliumthings.cilium.io' };
  const cond = (status: string) => ({ status: { conditions: [{ status, type: 'Established' }] } });
  expect(evaluate(crd, cond('True'))).toBe('ready');
  expect(evaluate(crd, cond('False'))).toBe('pending');
  expect(
    evaluate(crd, { status: { conditions: [{ status: 'True', type: 'NamesAccepted' }] } }),
  ).toBe('pending');
});

test('a missing or non-object body is pending, never ready', () => {
  for (const body of [undefined, null, 'ok', 7]) expect(evaluate(dep, body)).toBe('pending');
});

test('check keys are names and thresholds only', () => {
  const checks: ReadyCheck[] = [
    { kind: 'DaemonSet', minReady: 2, name: 'cilium', namespace: 'kube-system' },
    dep,
    { kind: 'CustomResourceDefinition', name: 'x.cilium.io' },
  ];
  expect(checkKey(checks[0] as ReadyCheck)).toBe('DaemonSet/kube-system/cilium:min=2');
  expect(checksCsv(checks)).toBe(
    'DaemonSet/kube-system/cilium:min=2,Deployment/kube-system/cilium-operator,CustomResourceDefinition/x.cilium.io',
  );
});
