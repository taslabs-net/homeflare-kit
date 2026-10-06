/**
 * `Kubernetes.Manifest` and `Kubernetes.HelmChart` THROUGH the registered `talos-openbao` adapter,
 * with a fake `bao` and a fake apiserver (`fake-apiserver.ts` — no socket, no vault, no cluster).
 * Proves the per-cluster config (each connection reaches its own endpoint, an unconfigured cluster
 * is refused, a retired cluster's delete is a no-op) and the IDENTITY RULE (cluster-adapter.ts):
 * a saved row whose cluster name was repointed at another physical cluster is refused with NO
 * request sent to either, while a matching uid still works and a missing uid fails closed.
 */
import { expect, test } from 'bun:test';
import { HelmChart, HelmChartProvider } from 'alchemy/Kubernetes/HelmChart';
import { Manifest, ManifestProvider } from 'alchemy/Kubernetes/Manifest';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from './cluster-adapter.ts';
import { fakeApiServer } from './fake-apiserver.ts';
import { type FakeCall, type FakeHandler, fakeSpawner } from './fake-process.ts';

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
/** Each physical cluster's kube-system uid, by apiserver host. */
const UIDS = { 'c1.cluster.invalid': 'uid-c1', 'c2.cluster.invalid': 'uid-c2' };

const layer = (adapterConfig: typeof config) =>
  Layer.mergeAll(
    ManifestProvider(),
    HelmChartProvider(),
    TalosOpenBaoAdapter(adapterConfig).pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(vault))),
    ),
  );

const withProvider = (
  resource: { Type: string },
  body: (service: never) => Effect.Effect<unknown, unknown, never>,
  adapterConfig: typeof config,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Provider.Provider<never>(resource.Type as never);
      return yield* body(service as never);
    }).pipe(Effect.provide(layer(adapterConfig))) as unknown as Effect.Effect<unknown, unknown>,
  );

type Body<R extends Manifest | HelmChart> = (
  s: Provider.ProviderService<R>,
) => Effect.Effect<unknown, unknown, never>;
const manifestApi = (body: Body<Manifest>, adapterConfig: typeof config = config) =>
  withProvider(Manifest, body as never, adapterConfig) as Promise<unknown>;
const helmApi = (body: Body<HelmChart>, adapterConfig: typeof config = config) =>
  withProvider(HelmChart, body as never, adapterConfig) as Promise<unknown>;

const session = { note: () => Effect.void } as never;
const manifestRow = (auth: { cluster: string; uid?: string }, name = 'ns-c1') => ({
  apiVersion: 'v1',
  connection: { auth: { kind: 'talos-openbao', ...auth } },
  kind: 'Namespace',
  name,
  namespace: undefined,
  ref: { apiVersion: 'v1', kind: 'Namespace', name },
  uid: 'u1',
});
const helmRow = (auth: { cluster: string; uid?: string }) => ({
  chart: 'oci://example.invalid/chart',
  code: { hash: 'h' },
  connection: { auth: { kind: 'talos-openbao', ...auth } },
  namespace: 'default',
  objects: [{ apiVersion: 'v1', kind: 'Namespace', name: 'ns-c1' }],
  releaseName: 'r',
  version: '1',
});

const failure = (run: () => Promise<unknown>) =>
  run().then(
    () => 'resolved',
    (error: unknown) => String(error),
  );

test('two clusters in one stack each reach their own endpoint, uid-checked first', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const reconcile = (cluster: string, uid: string) => (s: Provider.ProviderService<Manifest>) =>
      s.reconcile({
        news: {
          cluster: talosOpenBaoConnection(cluster, uid),
          manifest: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: `ns-${cluster}` } },
        },
        output: undefined,
        session,
      } as never);
    const out1 = (await manifestApi(reconcile('c1', 'uid-c1'))) as { connection: unknown };
    await manifestApi(reconcile('c2', 'uid-c2'));
    expect(api.seen).toEqual([
      'GET c1.cluster.invalid/api/v1/namespaces/kube-system',
      'PATCH c1.cluster.invalid/api/v1/namespaces/ns-c1',
      'GET c2.cluster.invalid/api/v1/namespaces/kube-system',
      'PATCH c2.cluster.invalid/api/v1/namespaces/ns-c2',
    ]);
    expect(JSON.stringify(out1.connection)).toBe(
      '{"auth":{"kind":"talos-openbao","cluster":"c1","uid":"uid-c1"}}',
    );
  } finally {
    api.restore();
  }
});

test('a connection naming an unconfigured cluster is refused before any request', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const message = await failure(() =>
      manifestApi((s) => s.delete({ output: manifestRow({ cluster: 'c9', uid: 'x' }) } as never)),
    );
    expect(message).toContain("no configuration for cluster 'c9'");
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});

test('delete on a retired cluster is a no-op, on a live one it reaches that cluster only', async () => {
  const api = fakeApiServer(UIDS);
  try {
    await manifestApi((s) =>
      s.delete({ output: manifestRow({ cluster: 'gone', uid: 'uid-gone' }) } as never),
    );
    expect(api.seen).toEqual([]);
    await manifestApi((s) =>
      s.delete({ output: manifestRow({ cluster: 'c2', uid: 'uid-c2' }, 'ns-c2') } as never),
    );
    expect(api.seen).toEqual([
      'GET c2.cluster.invalid/api/v1/namespaces/kube-system',
      'DELETE c2.cluster.invalid/api/v1/namespaces/ns-c2',
    ]);
  } finally {
    api.restore();
  }
});

// ★ THE CODEX SCENARIO: create with c1's config, then repoint the `c1` entry at c2's vault key and
//   delete the saved output. Before the identity rule that sent DELETE to c2.
const repointed = { ...config, c1: { ...config.c2, context: 'admin@c2' } };

test('a saved c1 row is refused when c1 now points at c2: no DELETE reaches either cluster', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const row = manifestRow({ cluster: 'c1', uid: 'uid-c1' });
    const message = await failure(() =>
      manifestApi((s) => s.delete({ output: row } as never), repointed),
    );
    expect(message).toContain('TalosClusterIdentityMismatch');
    expect(message).toContain('uid-c2');
    expect(api.seen.filter((call) => !call.startsWith('GET '))).toEqual([]);
    expect(api.seen).toEqual(['GET c2.cluster.invalid/api/v1/namespaces/kube-system']);
  } finally {
    api.restore();
  }
});

test('HelmChart cleanup is refused the same way', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const row = helmRow({ cluster: 'c1', uid: 'uid-c1' });
    const message = await failure(() =>
      helmApi((s) => s.delete({ output: row } as never), repointed),
    );
    expect(message).toContain('TalosClusterIdentityMismatch');
    expect(api.seen.filter((call) => !call.startsWith('GET '))).toEqual([]);
  } finally {
    api.restore();
  }
});

test('a matching uid still deletes on the right cluster (Manifest and HelmChart)', async () => {
  const api = fakeApiServer(UIDS);
  try {
    await manifestApi((s) =>
      s.delete({ output: manifestRow({ cluster: 'c1', uid: 'uid-c1' }) } as never),
    );
    await helmApi((s) => s.delete({ output: helmRow({ cluster: 'c1', uid: 'uid-c1' }) } as never));
    expect(api.seen.filter((call) => call.startsWith('DELETE '))).toEqual([
      'DELETE c1.cluster.invalid/api/v1/namespaces/ns-c1',
      'DELETE c1.cluster.invalid/api/v1/namespaces/ns-c1',
    ]);
  } finally {
    api.restore();
  }
});

test('a saved auth block with no uid fails closed with no request', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const message = await failure(() =>
      manifestApi((s) => s.delete({ output: manifestRow({ cluster: 'c1' }) } as never)),
    );
    expect(message).toContain('TalosClusterIdentityMissing');
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});
