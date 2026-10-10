/**
 * Secrecy of `HomeFlare.Kubernetes.Ready`: no PEM marker, kubeconfig byte or apiserver response
 * body reaches an attribute, an error, a log line, or a file. The vault is the fake `bao` of the
 * adapter fixtures (it serves a kubeconfig with PEM blocks); the apiserver bodies carry a needle.
 */
import { expect, spyOn, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Cause from 'effect/Cause';
import * as Logger from 'effect/Logger';
import * as References from 'effect/References';
import type { FakeObject } from '../talos/fake-apiserver.ts';
import { vault } from '../talos/cluster-adapter.fixtures.ts';
import { diffReady, readReady, reconcileReady } from './ready.ts';
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

const BODY_NEEDLE = 'apiserver-body-needle-7f3a';
const pemMarker = `-----${'BEGIN'}`;
const b64 = (text: string) => Buffer.from(text).toString('base64');
const props = {
  checks: [dsCheck, depCheck, crdCheck],
  connection,
  waitTimeout: '20s',
  pollInterval: '5s',
};

// The vault's own document is the needle source: every field value the fake `bao` serves.
const served = JSON.parse(
  vault({ args: ['talos-c1/data/kubeconfig'], command: 'bao' }).stdout ?? '{}',
) as {
  data: { data: { kubeconfig: string } };
};
const needles = [
  BODY_NEEDLE,
  pemMarker,
  served.data.data.kubeconfig,
  b64(`${pemMarker} CERTIFICATE-----`),
  b64(`${pemMarker} PRIVATE KEY-----`),
  'client-key-data',
  'certificate-authority-data',
];
const leaks = (text: string) => needles.filter((needle) => text.includes(needle));
const dump = (value: unknown) =>
  JSON.stringify(value, value instanceof Object ? Object.getOwnPropertyNames(value) : undefined) +
  String(value);

const ready: Record<string, FakeObject> = {
  [get(CRD_PATH)]: { body: readyCrd },
  [get(DEP_PATH)]: { body: readyDep },
  [get(DS_PATH)]: { body: readyDs },
};

test('attributes, errors and logs of every path carry no vault or response byte', async () => {
  const logged: string[] = [];
  const capture = Logger.layer([
    Logger.make(({ message }) => void logged.push(JSON.stringify(message))),
  ]);
  const saved = { ...console };
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  }
  const writes = [spyOn(Bun, 'write'), spyOn(Bun, 'spawn')];
  const outputs: unknown[] = [];
  try {
    const attempt = async (
      objects: Record<string, FakeObject>,
      run: Effect.Effect<unknown, unknown, never>,
    ) => {
      const exit = await withCluster(
        objects,
        driven(
          run.pipe(
            Effect.provideService(References.MinimumLogLevel, 'All'),
            Effect.provide(capture),
          ),
          100,
        ) as never,
      );
      const result = exit as Exit.Exit<unknown, unknown>;
      outputs.push(Exit.isSuccess(result) ? result.value : Cause.squash(result.cause));
    };
    const failing = (entry: FakeObject): Record<string, FakeObject> => ({
      ...ready,
      [get(DEP_PATH)]: { ...entry, body: { message: BODY_NEEDLE } },
    });
    for (const entry of [
      { status: 200 },
      { status: 404 },
      { status: 503 },
      { status: 403 },
      { status: 429 },
    ]) {
      for (const run of [
        readReady(props),
        reconcileReady(props),
        diffReady(props as never, { checks: '', connection, ready: false }),
      ]) {
        await attempt(failing(entry), run as never);
      }
    }
    await attempt(ready, reconcileReady(props) as never);
  } finally {
    Object.assign(console, saved);
    for (const spy of writes) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
  expect(outputs.length).toBeGreaterThan(10);
  expect(leaks(outputs.map(dump).join('\n'))).toEqual([]);
  expect(leaks(logged.join('\n'))).toEqual([]);
});

test('the probe can fail: a response body quoted into an error is caught by the needle check', () => {
  const quoted = new Error(`GET responded 503: ${JSON.stringify({ message: BODY_NEEDLE })}`);
  expect(leaks(dump(quoted))).toEqual([BODY_NEEDLE]);
});
