/**
 * Shared fixtures for the `talos-openbao` adapter tests that go THROUGH the real upstream
 * `ManifestProvider` / `HelmChartProvider`: a fake `bao` vault, per-cluster kubeconfigs, the
 * uid-pinned adapter config and the provider runners. The fake apiserver is `fake-apiserver.ts`.
 */
import { HelmChart, HelmChartProvider } from 'alchemy/Kubernetes/HelmChart';
import { Manifest, ManifestProvider } from 'alchemy/Kubernetes/Manifest';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter } from './cluster-adapter.ts';
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

/** Fake `bao kv get`: `talos-<name>` answers a kubeconfig for `<name>.cluster.invalid`. */
export const vault: FakeHandler = (call: FakeCall) => {
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

type Entry = {
  readonly context: string;
  readonly key: string;
  readonly mount: string;
  readonly uid: string;
  readonly retired?: boolean;
};
export type Config = Readonly<Record<string, Entry>>;

export const config = {
  c1: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
  c2: { context: 'admin@c2', key: 'kubeconfig', mount: 'talos-c2', uid: 'uid-c2' },
  gone: {
    context: 'admin@gone',
    key: 'kubeconfig',
    mount: 'talos-gone',
    retired: true,
    uid: 'uid-gone',
  },
} satisfies Config;
/** Each physical cluster's kube-system uid, by apiserver host. */
export const UIDS = { 'c1.cluster.invalid': 'uid-c1', 'c2.cluster.invalid': 'uid-c2' };

const layer = (adapterConfig: Config) =>
  Layer.mergeAll(
    ManifestProvider(),
    HelmChartProvider(),
    TalosOpenBaoAdapter(adapterConfig).pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(vault))),
    ),
  );

/** The layer an engine-level test provides: upstream providers plus the adapter. */
export const providerLayer = layer;

const withProvider = (
  resource: { Type: string },
  body: (service: never) => Effect.Effect<unknown, unknown, never>,
  adapterConfig: Config,
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
export const manifestApi = (body: Body<Manifest>, adapterConfig: Config = config) =>
  withProvider(Manifest, body as never, adapterConfig) as Promise<unknown>;
export const helmApi = (body: Body<HelmChart>, adapterConfig: Config = config) =>
  withProvider(HelmChart, body as never, adapterConfig) as Promise<unknown>;

export const session = { note: () => Effect.void } as never;

export const manifestRow = (auth: { cluster?: string; uid?: string }, name = 'ns-c1') => ({
  apiVersion: 'v1',
  connection: { auth: { kind: 'talos-openbao', ...auth } },
  kind: 'Namespace',
  name,
  namespace: undefined,
  ref: { apiVersion: 'v1', kind: 'Namespace', name },
  uid: 'u1',
});
export const helmRow = (auth: { uid?: string }) => ({
  chart: 'oci://example.invalid/chart',
  code: { hash: 'h' },
  connection: { auth: { kind: 'talos-openbao', ...auth } },
  namespace: 'default',
  objects: [{ apiVersion: 'v1', kind: 'Namespace', name: 'ns-c1' }],
  releaseName: 'r',
  version: '1',
});

export const failure = (run: () => Promise<unknown>) =>
  run().then(
    () => 'resolved',
    (error: unknown) => String(error),
  );
