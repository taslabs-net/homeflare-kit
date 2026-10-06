/**
 * `Kubernetes.Manifest` reconcile and delete THROUGH the registered `talos-openbao` adapter, with a
 * fake `bao` and a fake cluster (`node:https` request spy — no socket, no vault, no cluster).
 * Proves the per-cluster config: each connection reaches its own endpoint, a connection naming an
 * unconfigured cluster is refused before any request, and a retired cluster's delete is a no-op.
 */
import { EventEmitter } from 'node:events';
import * as httpsNamespace from 'node:https';
import { expect, mock, test } from 'bun:test';
import { Manifest, ManifestProvider } from 'alchemy/Kubernetes/Manifest';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from './cluster-adapter.ts';
import { type FakeCall, type FakeHandler, fakeSpawner } from './fake-process.ts';

const realHttps = { ...httpsNamespace };
const b64 = (text: string) => Buffer.from(text).toString('base64');
const pem = (label: string) => `-----${'BEGIN'} ${label}-----\n${b64(label)}\n`;
const kubeconfig = (name: string, server: string) => `apiVersion: v1
kind: Config
clusters:
  - name: ${name}
    cluster: { server: '${server}', certificate-authority-data: ${b64(pem('CERTIFICATE'))} }
contexts:
  - name: admin@${name}
    context: { cluster: ${name}, user: admin@${name} }
users:
  - name: admin@${name}
    user: { client-certificate-data: ${b64(pem('CERTIFICATE'))}, client-key-data: ${b64(pem('PRIVATE KEY'))} }
`;

const vault: FakeHandler = (call: FakeCall) => {
  const path = call.args.at(-1) ?? '';
  const [mount] = path.split('/');
  if (mount === 'talos-gone') {
    return { exitCode: 2, stderr: 'No value found at talos-gone/data/kubeconfig' };
  }
  const name = mount?.replace('talos-', '') ?? '';
  return {
    stdout: JSON.stringify({
      data: { data: { kubeconfig: kubeconfig(name, `https://${name}.cluster.invalid:6443`) } },
    }),
  };
};
const config = {
  c1: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1' },
  c2: { context: 'admin@c2', key: 'kubeconfig', mount: 'talos-c2' },
  gone: { context: 'admin@gone', key: 'kubeconfig', mount: 'talos-gone', retired: true },
};

/** Fake apiserver: records `METHOD host path`, answers 200 with an empty object. */
const fakeApiServer = () => {
  const seen: string[] = [];
  // ★ mock.module, not spyOn: alchemy imports `* as https`, a namespace a spy on the default
  //   export never reaches (measured 2026-10-06: the spy was bypassed and the test hit real DNS).
  const spy = { mockRestore: () => mock.module('node:https', () => realHttps) };
  const fake = ((
    options: { hostname: string; method: string; path: string },
    callback: (response: EventEmitter & { statusCode?: number }) => void,
  ) => {
    seen.push(`${options.method} ${options.hostname}${options.path.split('?')[0]}`);
    const request = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    request.write = () => undefined;
    request.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      response.emit('data', Buffer.from('{"metadata":{"uid":"u1"}}'));
      response.emit('end');
    };
    return request;
  }) as never;
  mock.module('node:https', () => ({
    ...realHttps,
    default: { ...realHttps, request: fake },
    request: fake,
  }));
  return { seen, spy };
};

const namespace = (cluster: string) => ({
  cluster: talosOpenBaoConnection(cluster),
  manifest: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: `ns-${cluster}` } },
});

const withProvider = <A, E>(
  body: (service: Provider.ProviderService<Manifest>) => Effect.Effect<A, E, never>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Provider.Provider<Manifest>(Manifest.Type);
      return yield* body(service);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ManifestProvider(),
          TalosOpenBaoAdapter(config).pipe(
            Layer.provide(
              Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(vault)),
            ),
          ),
        ),
      ),
    ) as Effect.Effect<A, E, never>,
  );

const session = { note: () => Effect.void } as never;
const reconcile = (cluster: string) => (service: Provider.ProviderService<Manifest>) =>
  service.reconcile({ news: namespace(cluster), output: undefined, session } as never);

test('two clusters in one stack each reach their own endpoint', async () => {
  const api = fakeApiServer();
  try {
    const out1 = (await withProvider(reconcile('c1'))) as { connection: unknown };
    await withProvider(reconcile('c2'));
    expect(api.seen).toEqual([
      'PATCH c1.cluster.invalid/api/v1/namespaces/ns-c1',
      'PATCH c2.cluster.invalid/api/v1/namespaces/ns-c2',
    ]);
    expect(JSON.stringify(out1.connection)).toBe(
      '{"auth":{"kind":"talos-openbao","cluster":"c1"}}',
    );
  } finally {
    api.spy.mockRestore();
  }
});

test('a connection naming an unconfigured cluster is refused before any request', async () => {
  const api = fakeApiServer();
  try {
    const message = await withProvider(reconcile('c9')).catch((e: unknown) => String(e));
    expect(message).toContain("no configuration for cluster 'c9'");
    expect(api.seen).toEqual([]);
  } finally {
    api.spy.mockRestore();
  }
});

test('delete on a retired cluster is a no-op, on a live one it reaches that cluster only', async () => {
  const api = fakeApiServer();
  const row = (cluster: string) => ({
    apiVersion: 'v1',
    connection: talosOpenBaoConnection(cluster),
    kind: 'Namespace',
    name: `ns-${cluster}`,
    namespace: undefined,
    ref: { apiVersion: 'v1', kind: 'Namespace', name: `ns-${cluster}` },
    uid: 'u1',
  });
  try {
    await withProvider((s) => s.delete({ output: row('gone') } as never));
    expect(api.seen).toEqual([]);
    await withProvider((s) => s.delete({ output: row('c2') } as never));
    expect(api.seen).toEqual(['DELETE c2.cluster.invalid/api/v1/namespaces/ns-c2']);
  } finally {
    api.spy.mockRestore();
  }
});
