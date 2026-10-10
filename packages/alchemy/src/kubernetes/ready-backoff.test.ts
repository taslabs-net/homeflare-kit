/**
 * Socket rationing of the poll (upstream `readObject` takes no signal, so a timed-out GET abandons
 * its socket) and the `diff` tolerance of transients. Fake apiserver in hung mode; time is TestClock's.
 */
import { expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Duration from 'effect/Duration';
import * as Exit from 'effect/Exit';
import { connectCluster } from 'alchemy/Kubernetes/internal/client';
import type { FakeObject } from '../talos/fake-apiserver.ts';
import { poll } from './ready-poll.ts';
import { diffReady } from './ready.ts';
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

const checks = [dsCheck, depCheck, crdCheck];
const allReady = (): Record<string, FakeObject> => ({
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
});

/** A live table that counts the GETs each key receives (the fake reads the table once per request). */
const counting = (objects: Record<string, FakeObject>) => {
  const counts: Record<string, number> = {};
  const table = new Proxy(objects, {
    get: (target, prop) => {
      counts[prop as string] = (counts[prop as string] ?? 0) + 1;
      return target[prop as string];
    },
  });
  return { counts, table };
};

const prior = {
  checks: [
    'DaemonSet/kube-system/cilium',
    'Deployment/kube-system/cilium-operator',
    'CustomResourceDefinition/x.cilium.io',
  ].join(','),
  connection,
  ready: true,
};

test('a hung apiserver costs few GETs over 10 minutes: back-off doubles the pause, capped at 30 s', async () => {
  const { counts, table } = counting({ ...allReady(), [get(DS_PATH)]: { hang: true } });
  const exit = await withCluster(
    table,
    driven(
      poll(() => connectCluster(connection), checks, Duration.minutes(10), Duration.seconds(10)),
      700,
    ),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  // 5 s timeout + pause 20, 30, 30 ...: about 18 GETs. Without back-off it is about 40.
  expect(counts[get(DS_PATH)]).toBeGreaterThan(10);
  expect(counts[get(DS_PATH)]).toBeLessThan(25);
});

test('once a GET times out, the rest of that pass issues no GET and is pending', async () => {
  const { counts, table } = counting({ ...allReady(), [get(DS_PATH)]: { hang: true } });
  const exit = await withCluster(
    table,
    driven(
      poll(() => connectCluster(connection), checks, Duration.minutes(2), Duration.seconds(10)),
      200,
    ),
  );
  const error = Cause.squash((exit as Exit.Failure<unknown, unknown>).cause) as {
    failing: string[];
  };
  expect(counts[get(DEP_PATH)] ?? 0).toBe(0);
  expect(counts[get(CRD_PATH)] ?? 0).toBe(0);
  expect(error.failing).toHaveLength(3);
});

for (const [name, entry] of [
  ['a 503', { status: 503, body: { secret: 'x' } }],
  ['a 429', { status: 429 }],
  ['a hung GET', { hang: true }],
] as const) {
  test(`diff returns update on ${name} instead of failing the plan`, async () => {
    const objects = { ...allReady(), [get(DEP_PATH)]: entry };
    const out = await withCluster(
      objects,
      driven(diffReady({ checks, connection } as never, prior), 30),
    );
    expect(Exit.isSuccess(out)).toBe(true);
    expect((out as Exit.Success<unknown>).value).toEqual({ action: 'update' });
  });
}

test('diff returns update when the connect itself hits a 503; 401/403 still fail the plan', async () => {
  const identity = get('/api/v1/namespaces/kube-system');
  const ok = await withCluster(
    { ...allReady(), [identity]: { status: 503 } },
    driven(diffReady({ checks, connection } as never, prior), 30),
  );
  expect((ok as Exit.Success<unknown>).value).toEqual({ action: 'update' });
  for (const status of [401, 403]) {
    const out = await withCluster(
      { ...allReady(), [get(DS_PATH)]: { status } },
      driven(diffReady({ checks, connection } as never, prior), 30),
    );
    expect(Exit.isFailure(out)).toBe(true);
    expect(
      (Cause.squash((out as Exit.Failure<unknown, unknown>).cause) as { statusCode: number })
        .statusCode,
    ).toBe(status);
  }
});
