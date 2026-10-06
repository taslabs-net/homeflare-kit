/**
 * `talos-openbao` secrecy and identity, through the real adapter and provider paths. Fake `bao`
 * only. Asserts the persisted Connection is `{ kind, cluster }` (so a vault-key rename cannot make
 * upstream answer `replace` and delete same-named objects), and that no PEM marker, base64 key
 * body or kubeconfig byte reaches attributes, error fields, disk or logs.
 */
import { existsSync, readdirSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { ClusterAdapter, ClusterNotFoundError } from 'alchemy/Kubernetes/ClusterAdapter';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, connectTalosOpenBao } from './cluster-adapter.ts';
import { readKvValue } from './credentials.ts';
import { type FakeCall, type FakeHandler, fakeSpawner } from './fake-process.ts';
import { buildAttrs } from './kubeconfig-attrs.ts';
import { talosctl } from './talosctl.ts';
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
const config = { cluster: 'c1', context: 'admin@hf-c1', key: 'kubeconfig', mount: 'talos-c1' };
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
const tmpFiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith('hf-'));
const needles = [begin('CERTIFICATE'), begin('PRIVATE KEY'), certBody, keyBody];
const leaks = (text: string) => needles.filter((needle) => text.includes(needle));

test('changing mount, key or context does not change the persisted Connection', async () => {
  const persisted = (cfg: typeof config) => {
    const attrs = buildAttrs(yaml, {
      context: cfg.context,
      kubeconfigKey: cfg.key,
      node: '198.51.100.10',
      target: { cluster: cfg.cluster, mount: cfg.mount },
    });
    return JSON.stringify(attrs?.connection);
  };
  const a = persisted(config);
  expect(a).toBe('{"auth":{"kind":"talos-openbao","cluster":"c1"}}');
  expect(persisted({ ...config, key: 'k2', mount: 'm2' })).toBe(a);
  expect(a).not.toContain('kubeconfig');
  expect(a).not.toContain('talos-c1');
});

test('connect through the layer leaves no PEM in tagged errors, temp files or logs', async () => {
  const before = tmpFiles();
  const logged: string[] = [];
  const saved = { ...console };
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  }
  try {
    const run = (handler: FakeHandler) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* ClusterAdapter('talos-openbao');
          return yield* adapter.connect({ auth: { kind: 'talos-openbao', cluster: 'c1' } });
        }).pipe(Effect.provide(TalosOpenBaoAdapter(config).pipe(Layer.provide(spawner(handler))))),
      );
    await run(vault);
    const attempts = [
      run(() => ({ exitCode: 2, stderr: 'No value found at talos-c1/data/kubeconfig' })),
      run(() => ({ stdout: `${pemKey} not json` })),
      run(() => ({ stdout: JSON.stringify({ data: { data: { kubeconfig: pemKey } } }) })),
    ];
    const failures = await Promise.all(attempts.map((attempt) => attempt.catch((e: unknown) => e)));
    expect(failures[0]).toBeInstanceOf(ClusterNotFoundError);
    for (const failure of failures) {
      const text = JSON.stringify(failure, Object.getOwnPropertyNames(failure as object));
      expect(leaks(`${text}${String(failure)}`)).toEqual([]);
    }
  } finally {
    Object.assign(console, saved);
  }
  expect(leaks(logged.join('\n'))).toEqual([]);
  expect(tmpFiles()).toEqual(before);
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

test('HF_TALOSCTL must be absolute, non-writable by others, and the pinned version', async () => {
  const run = (binary: string, handler: FakeHandler = () => ({})) =>
    provide(talosctl(['version'], { binary, talosconfigPath: 'unused.yaml' }), handler).catch(
      (e: unknown) => String(e),
    );
  expect(await run('relative/talosctl')).toContain('absolute');
  expect(await run('/definitely/not/here/talosctl')).toContain('not a readable file');
  const bin = `${tmpdir()}/hf-talosctl-probe-${Bun.randomUUIDv7()}`;
  await Bun.write(bin, '#!/bin/sh\n');
  try {
    await Bun.$`chmod 0777 ${bin}`.quiet();
    expect(await run(bin)).toContain('group- or world-writable');
    await Bun.$`chmod 0755 ${bin}`.quiet();
    expect(await run(bin, () => ({ stdout: 'Client: Tag: v1.13.8' }))).toContain('v1.14.2');
    const pinned = 'Client: Tag: v1.14.2';
    expect(await run(bin, () => ({ stdout: pinned }))).toBe(pinned);
  } finally {
    await Bun.file(bin).delete();
  }
});
