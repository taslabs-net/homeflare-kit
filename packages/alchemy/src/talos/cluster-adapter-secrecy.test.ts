/**
 * `talos-openbao` secrecy and identity, through the real adapter and provider paths. Fake `bao`
 * only. Asserts the persisted Connection is `{ kind, uid }` (so a vault-key rename cannot make
 * upstream answer `replace` and delete same-named objects), and that no PEM marker, base64 key
 * body or kubeconfig byte reaches attributes, error fields, disk or logs.
 */
import fs, { existsSync } from 'node:fs';
import { expect, mock, spyOn, test } from 'bun:test';
import { ClusterAdapter } from 'alchemy/Kubernetes/ClusterAdapter';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as References from 'effect/References';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import {
  TalosOpenBaoAdapter,
  TalosVaultKeyMissing,
  connectTalosOpenBao,
  talosOpenBaoConnection,
} from './cluster-adapter.ts';
import { fakeApiServer } from './fake-apiserver.ts';
import { readKvValue } from './credentials.ts';
import { type FakeCall, type FakeHandler, fakeSpawner } from './fake-process.ts';
import { buildAttrs } from './kubeconfig-attrs.ts';
import { tmpdir } from 'node:os';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const begin = (label: string) => `-----${'BEGIN'} ${label}-----`;
const certBody = b64('not-a-cert');
const keyBody = b64('not-a-key');
const pemCert = `${begin('CERTIFICATE')}\n${certBody}\n`;
const pemKey = `${begin('PRIVATE KEY')}\n${keyBody}\n`;
const yaml = `apiVersion: v1
kind: Config
clusters:
  - name: hf-c1
    cluster: { server: 'https://192.0.2.50:6443', certificate-authority-data: ${b64(pemCert)} }
contexts:
  - name: admin@hf-c1
    context: { cluster: hf-c1, user: admin@hf-c1 }
users:
  - name: admin@hf-c1
    user: { client-certificate-data: ${b64(pemCert)}, client-key-data: ${b64(pemKey)} }
`;
const config = {
  c1: { context: 'admin@hf-c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
};
const vault: FakeHandler = () => ({
  stdout: JSON.stringify({ data: { data: { kubeconfig: yaml } } }),
});
const spawner = (handler: FakeHandler, calls: FakeCall[] = []) =>
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(handler, calls));
const provide = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: FakeHandler,
  calls: FakeCall[] = [],
) => Effect.runPromise(Effect.provide(effect, spawner(handler, calls)));
const needles = [begin('CERTIFICATE'), begin('PRIVATE KEY'), certBody, keyBody];
const leaks = (text: string) => needles.filter((needle) => text.includes(needle));

test('the persisted Connection is { kind, uid } and carries no vault path', () => {
  // ★ buildAttrs persists no connection at all (kubeconfig-attrs.ts): only the identity resource
  //   does, and its connection is a function of the cluster name and uid, never mount/key/context.
  const attrs = buildAttrs(yaml, {
    context: config.c1.context,
    node: '198.51.100.10',
    target: { cluster: 'c1', mount: config.c1.mount },
  });
  expect(Object.keys(attrs ?? {})).not.toContain('connection');
  const a = JSON.stringify(talosOpenBaoConnection('uid-c1'));
  expect(a).toBe('{"auth":{"kind":"talos-openbao","uid":"uid-c1"}}');
  expect(a).not.toContain('kubeconfig');
  expect(a).not.toContain('talos-c1');
});

test('connect through the layer leaves no PEM in tagged errors, temp files or logs', async () => {
  // ★ Spies, not a before/after temp-dir listing: a write that is cleaned up again, or lands
  //   outside tmpdir, still fails here. Anything carrying kubeconfig material is a leak.
  const written: string[] = [];
  const note = (data: unknown) => void written.push(String(data));
  // ⚠️ credentials.ts and kubeconfig.ts use NAMED imports from node:fs, which a spy on the fs
  //   default export never reaches (the earlier version of this test could not fail). So the module
  //   itself is mocked, like fake-apiserver.ts does for node:https. mock.module is process-wide in
  //   bun: only the three write entry points are replaced, and the real module goes back in finally.
  const realFs = { ...fs };
  const fakeFs = {
    ...realFs,
    openSync: () => {
      throw new Error('openSync is not expected on the connect path');
    },
    writeFileSync: (_path: unknown, data: unknown) => note(data),
  };
  mock.module('node:fs', () => ({ ...fakeFs, default: fakeFs }));
  const spies = [
    spyOn(Bun, 'write').mockImplementation(((_d: unknown, data: unknown) => {
      note(data);
      return Promise.resolve(0);
    }) as never),
  ];
  // ★ Effect.logDebug of raw bytes only shows when the level is "All" and a Logger captures it.
  const logged: string[] = [];
  const capture = Logger.layer([
    Logger.make(({ message }) => void logged.push(JSON.stringify(message))),
  ]);
  const saved = { ...console };
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  }
  const api = fakeApiServer({ '192.0.2.50': 'uid-c1' });
  try {
    const run = (handler: FakeHandler) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* ClusterAdapter('talos-openbao');
          return yield* adapter.connect(talosOpenBaoConnection('uid-c1'));
        }).pipe(
          Effect.provide(TalosOpenBaoAdapter(config).pipe(Layer.provide(spawner(handler)))),
          Effect.provide(capture),
          Effect.provideService(References.MinimumLogLevel, 'All'),
        ),
      );
    await run(vault);
    const attempts = [
      run(() => ({ exitCode: 2, stderr: 'No value found at talos-c1/data/kubeconfig' })),
      run(() => ({ stdout: `${pemKey} not json` })),
      run(() => ({ stdout: JSON.stringify({ data: { data: { kubeconfig: pemKey } } }) })),
    ];
    const failures = await Promise.all(attempts.map((attempt) => attempt.catch((e: unknown) => e)));
    expect(failures[0]).toBeInstanceOf(TalosVaultKeyMissing);
    for (const failure of failures) {
      const text = JSON.stringify(failure, Object.getOwnPropertyNames(failure as object));
      expect(leaks(`${text}${String(failure)}`)).toEqual([]);
    }
  } finally {
    Object.assign(console, saved);
    api.restore();
    for (const spy of spies) spy.mockRestore();
    mock.module('node:fs', () => ({ ...realFs, default: realFs }));
  }
  expect(leaks(logged.join('\n'))).toEqual([]);
  expect(written).toEqual([]);
});

test('Effect.logDebug of raw bytes is caught by the capturing logger (the probe can fail)', async () => {
  const logged: string[] = [];
  const capture = Logger.make(({ message }) => void logged.push(JSON.stringify(message)));
  await Effect.runPromise(
    Effect.logDebug(pemKey).pipe(
      Effect.provide(Logger.layer([capture])),
      Effect.provideService(References.MinimumLogLevel, 'All'),
    ),
  );
  expect(leaks(logged.join('\n'))).not.toEqual([]);
});

test('bao is refused without BAO_ADDR and BAO_TOKEN, and gets a minimal env', async () => {
  const saved = { addr: process.env['BAO_ADDR'], token: process.env['BAO_TOKEN'] };
  process.env['HOME_SECRET_PROBE'] = 'x';
  try {
    delete process.env['BAO_TOKEN'];
    const calls: FakeCall[] = [];
    await expect(
      provide(readKvValue('talos-c1', 'kubeconfig', ['kubeconfig']), vault, calls),
    ).rejects.toThrow(/BAO_ADDR and BAO_TOKEN/);
    expect(calls).toEqual([]);
    process.env['BAO_TOKEN'] = saved.token ?? 'fake-test-token';
    const cmds: Record<string, unknown>[] = [];
    const layer = ChildProcessSpawner.make((cmd) => {
      if (cmd._tag === 'StandardCommand') cmds.push({ ...cmd.options });
      return fakeSpawner(vault).spawn(cmd);
    });
    await Effect.runPromise(
      Effect.provideService(
        readKvValue('talos-c1', 'kubeconfig', ['kubeconfig']),
        ChildProcessSpawner.ChildProcessSpawner,
        layer,
      ),
    );
    const env = cmds[0]?.['env'] as Record<string, string>;
    expect(cmds[0]?.['extendEnv']).toBe(false);
    expect(Object.keys(env)).not.toContain('HOME_SECRET_PROBE');
  } finally {
    delete process.env['HOME_SECRET_PROBE'];
    if (saved.token === undefined) delete process.env['BAO_TOKEN'];
    else process.env['BAO_TOKEN'] = saved.token;
  }
});

test('non-JSON bao output never quotes its bytes', async () => {
  const error = await provide(readKvValue('talos-c1', 'kubeconfig', ['kubeconfig']), () => ({
    stdout: `${pemKey}{`,
  })).catch((e: unknown) => e);
  const message = String((error as Error).message);
  expect(message).toContain('not JSON');
  expect(leaks(message)).toEqual([]);
  expect(message).not.toContain('Unexpected');
});

test('connect fails with the typed adapter error when the kind mismatches', async () => {
  const outcome = await provide(
    connectTalosOpenBao(config, { auth: { kind: 'token', token: 'not-a-token' } }).pipe(
      Effect.catchTag('TalosOpenBaoAuthKind', () => Effect.succeed('mismatch')),
    ),
    vault,
  );
  expect(outcome).toBe('mismatch');
  expect(existsSync(`${tmpdir()}/talos-openbao`)).toBe(false);
});
