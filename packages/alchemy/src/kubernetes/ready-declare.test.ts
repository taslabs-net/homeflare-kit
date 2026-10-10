/**
 * Declaration-time refusals of `HomeFlare.Kubernetes.Ready` (round 1, findings 3 and 5): checks that
 * can never pass, and an `after` that would let the gate be skipped.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Output from 'alchemy/Output';
import { declarationRefusal, declaredReady } from './ready-declare.ts';
import { KubernetesReady } from './ready.ts';
import { connection, crdCheck, depCheck, dsCheck } from './ready.fixtures.ts';

const refusal = (extra: object) =>
  declarationRefusal({ checks: [dsCheck, depCheck, crdCheck], connection, ...extra }) as
    | { _tag: string; index: number; problem?: string }
    | undefined;
const badCheck = (check: object) => refusal({ checks: [check] });

test('valid checks and no `after` are accepted', () => {
  expect(refusal({})).toBeUndefined();
  expect(refusal({ checks: [{ ...dsCheck, minReady: 2 }] })).toBeUndefined();
});

test('an empty list, an empty name, a missing namespace and a bad minReady are typed refusals', () => {
  expect(refusal({ checks: [] })?._tag).toBe('KubernetesReadyBadCheck');
  for (const check of [
    { ...dsCheck, name: '' },
    { ...depCheck, namespace: '' },
    { kind: 'Deployment', name: 'x' },
    { kind: 'DaemonSet', name: 'x', namespace: undefined },
    { ...dsCheck, minReady: 0 },
    { ...dsCheck, minReady: 1.5 },
    { ...dsCheck, minReady: '2' },
    { ...depCheck, minReady: 1 },
    { ...crdCheck, name: '' },
    { kind: 'Pod', name: 'x', namespace: 'y' },
  ]) {
    expect(badCheck(check)?._tag).toBe('KubernetesReadyBadCheck');
  }
});

// REAL property expressions of a chart (round 2: a plain-object stand-in hid that `chart.connection`
// passed). Only `chart.objects` stays lazy while the chart updates; every other property is a stable.
const chart = Output.of({ LogicalId: 'chart', Type: 'Kubernetes.HelmChart' } as never);
const prop = (name: string) => new Output.PropExpr(chart as never, name as never);
const lazy = prop('objects');
const stableLike = { auth: { kind: 'talos-openbao', uid: 'uid-c1' } };

test('`after` accepts only chart.objects and refuses every other shape (a chart stable resolves at plan time)', () => {
  expect(refusal({ after: [lazy] })).toBeUndefined();
  for (const stable of ['connection', 'releaseName', 'namespace']) {
    expect(refusal({ after: [prop(stable)] })).toMatchObject({
      _tag: 'KubernetesReadyBadAfter',
      index: 0,
    });
  }
  expect(refusal({ after: [Output.literal([{ kind: 'Deployment' }])] })).toMatchObject({
    _tag: 'KubernetesReadyBadAfter',
    index: 0,
  });
  expect(refusal({ after: [stableLike] })).toMatchObject({
    _tag: 'KubernetesReadyBadAfter',
    index: 0,
  });
  // a bare `chart` is a ResourceExpr whose stables resolve at plan time: also refused
  expect(refusal({ after: [chart] })).toMatchObject({ _tag: 'KubernetesReadyBadAfter', index: 0 });
  expect(refusal({ after: [lazy, 'chart'] })).toMatchObject({
    _tag: 'KubernetesReadyBadAfter',
    index: 1,
  });
});

test('declaration fails with the typed error for plain props and for a props Effect', async () => {
  const bad = { checks: [{ ...depCheck, namespace: '' }], connection };
  const plain = await Effect.runPromise(Effect.flip(KubernetesReady('x', bad as never) as never));
  expect((plain as { _tag: string })._tag).toBe('KubernetesReadyBadCheck');
  // the props-Effect branch, over a stand-in constructor (the real one needs a Stack to run)
  const wrapped = declaredReady((_id: string, props: unknown) => props);
  const viaEffect = wrapped('x', Effect.succeed(bad)) as Effect.Effect<unknown, { _tag: string }>;
  expect((await Effect.runPromise(Effect.flip(viaEffect)))._tag).toBe('KubernetesReadyBadCheck');
  const after = { checks: [dsCheck], connection, after: [stableLike] };
  const skipped = await Effect.runPromise(
    Effect.flip(KubernetesReady('x', after as never) as never),
  );
  expect((skipped as { _tag: string })._tag).toBe('KubernetesReadyBadAfter');
});
