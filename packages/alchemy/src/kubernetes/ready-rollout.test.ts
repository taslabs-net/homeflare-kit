/** Round 1, findings 1 and 7: the lower bound on updated-and-available pods, and the strategy rule. */
import { expect, test } from 'bun:test';
import { type ReadyCheck, evaluate } from './ready-checks.ts';

const check = (minReady?: number): ReadyCheck => ({
  kind: 'DaemonSet',
  name: 'cilium',
  namespace: 'kube-system',
  ...(minReady === undefined ? {} : { minReady }),
});
const ds = (status: object, minReady?: number, spec: object = {}) =>
  evaluate(check(minReady), { metadata: { generation: 2 }, spec, status });
const status = (desired: number, updated: number, available: number) => ({
  desiredNumberScheduled: desired,
  numberAvailable: available,
  numberReady: available,
  observedGeneration: 2,
  updatedNumberScheduled: updated,
});

// `numberAvailable` counts AVAILABLE OLD-template pods too (kubectl demands updated == desired).
test('(a) 4 nodes, minReady 2: 2 new pods crashloop, 2 old pods available is pending', () => {
  expect(ds(status(4, 2, 2), 2)).toBe('pending');
});

test('(b) 3 nodes: new pod on A works, new pod on B crashloops, C runs the old pod: pending', () => {
  expect(ds(status(3, 2, 2), 2)).toBe('pending');
});

test('once the new pods really are available the same shapes are ready', () => {
  expect(ds(status(4, 2, 4), 2)).toBe('ready'); // 2 updated, 2 old: 4 - 2 = 2 updated-available
  expect(ds(status(3, 2, 3), 2)).toBe('ready');
});

test('the bound is a lower bound, not an exact count', () => {
  // all 3 on the new template, 2 available: 2 - 0 >= 2
  expect(ds(status(3, 3, 2), 2)).toBe('ready');
  // 3 on the new template and 1 available is not
  expect(ds(status(3, 3, 1), 2)).toBe('pending');
  // updated below the bar fails even when everything is available
  expect(ds(status(4, 1, 4), 2)).toBe('pending');
});

test('the default minReady (every node) is unchanged by the bound', () => {
  expect(ds(status(3, 3, 3))).toBe('ready');
  expect(ds(status(3, 2, 3))).toBe('pending');
});

test('a non-RollingUpdate strategy is a terminal failure; absent means RollingUpdate', () => {
  const rolled = status(3, 3, 3);
  expect(ds(rolled, undefined, { updateStrategy: { type: 'OnDelete' } })).toBe('failed');
  expect(ds(rolled, undefined, { updateStrategy: { type: 'RollingUpdate' } })).toBe('ready');
  expect(ds(rolled, undefined, {})).toBe('ready');
  // checked before the generation rule, as kubectl does
  expect(
    ds({ ...rolled, observedGeneration: 1 }, undefined, { updateStrategy: { type: 'x' } }),
  ).toBe('failed');
});
