/**
 * `talos-openbao` connect, offline. Fake `bao` only — no vault, no cluster, no kubeconfig on disk.
 */
import type { ClusterLike, Connection } from 'alchemy/Kubernetes/Connection';
import { ClusterAdapter, ClusterNotFoundError } from 'alchemy/Kubernetes/ClusterAdapter';
import { type HelmChart } from 'alchemy/Kubernetes/HelmChart';
import { type Manifest } from 'alchemy/Kubernetes/Manifest';
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import {
  TalosOpenBaoAdapter,
  connectTalosOpenBao,
  talosOpenBaoConnection,
} from './cluster-adapter.ts';
import { fakeApiServer } from './fake-apiserver.ts';
import { type FakeCall, type FakeHandler, fakeSpawner } from './fake-process.ts';
import { buildAttrs } from './kubeconfig-attrs.ts';
import type { ClusterHealthAttributes } from './talos-cluster-health.ts';

type HealthIsClusterLike = ClusterHealthAttributes extends ClusterLike ? true : never;
const healthIsClusterLike: HealthIsClusterLike = true;

const beginLine = (label: string) => `-----${'BEGIN'} ${label}-----`;
const armor = (label: string, body: string) =>
  `${beginLine(label)}\n${body}\n-----${'END'} ${label}-----\n`;
const b64 = (text: string) => Buffer.from(text).toString('base64');
// Fake bodies computed at runtime (base64 of fixed words) so no literal looks like a credential to gitleaks.
const pemCert = armor('CERTIFICATE', b64('not-a-cert'));
const pemKey = armor('PRIVATE KEY', b64('not-a-key'));

/** The raw document contains the PEM markers (comments) and their base64 payloads. */
const kubeconfigYaml = `# ${beginLine('CERTIFICATE')}
# ${beginLine('PRIVATE KEY')}
apiVersion: v1
kind: Config
clusters:
  - name: hf-c1
    cluster:
      server: https://192.0.2.50:6443
      certificate-authority-data: ${b64(pemCert)}
contexts:
  - name: admin@hf-c1
    context: { cluster: hf-c1, user: admin@hf-c1 }
users:
  - name: admin@hf-c1
    user:
      client-certificate-data: ${b64(pemCert)}
      client-key-data: ${b64(pemKey)}
current-context: admin@hf-c1
`;

const config = { c1: { context: 'admin@hf-c1', key: 'kubeconfig', mount: 'talos-c1' } };
const connection = talosOpenBaoConnection('c1', 'uid-c1');

const baoGet =
  (stdout: string): FakeHandler =>
  (call) => {
    if (call.command !== 'bao' || call.args[1] !== 'get') {
      throw new Error(`unexpected call ${call.command} ${call.args.join(' ')}`);
    }
    return { stdout };
  };

const provideBao = (handler: FakeHandler, calls: FakeCall[]) =>
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner(handler, calls));

/** Through the registered adapter, so a missing layer cannot pass this test. */
const runAdapter = (target: Connection, handler: FakeHandler, calls: FakeCall[] = []) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const adapter = yield* ClusterAdapter('talos-openbao');
      return yield* adapter.connect(target);
    }).pipe(
      Effect.provide(TalosOpenBaoAdapter(config).pipe(Layer.provide(provideBao(handler, calls)))),
    ),
  );

/** Direct connect, so `catchTag` sees the typed error channel the layer's signature widens. */
const runDirect = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: FakeHandler,
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );

const persisted = () => {
  const attrs = buildAttrs(kubeconfigYaml, {
    context: 'admin@hf-c1',
    node: '198.51.100.10',
    target: { cluster: 'c1', mount: 'talos-c1' },
  });
  if (attrs === undefined) throw new Error('fixture kubeconfig did not parse');
  const helm = {
    chart: 'oci://quay.io/cilium/charts/cilium',
    code: { hash: 'abc' },
    connection,
    namespace: 'kube-system',
    objects: [],
    releaseName: 'cilium',
    version: '1.20.2',
  } satisfies HelmChart['Attributes'];
  const manifest = {
    apiVersion: 'v1',
    connection,
    kind: 'Namespace',
    name: 'kube-system',
    namespace: 'kube-system',
    ref: { apiVersion: 'v1', kind: 'Namespace', name: 'kube-system' },
    uid: undefined,
  } satisfies Manifest['Attributes'];
  return JSON.stringify({ helm, manifest, kubeconfig: attrs });
};

test('ClusterHealth attributes are ClusterLike', () => {
  expect(healthIsClusterLike).toBe(true);
});

test('HelmChart and Manifest attributes carry no PEM and no sentinel path', () => {
  expect(kubeconfigYaml).toContain('BEGIN CERTIFICATE');
  expect(kubeconfigYaml).toContain('PRIVATE KEY');
  const encoded = persisted();
  expect(encoded).not.toContain('BEGIN CERTIFICATE');
  expect(encoded).not.toContain('PRIVATE KEY');
  expect(encoded).not.toContain(b64(pemCert));
  expect(encoded).not.toContain(b64(pemKey));
  expect(encoded).not.toContain('talos-first-boot-unwired');
  expect(encoded).not.toContain('client-cert');
  expect(encoded).toContain('talos-openbao');
});

test('connect reads the vault in memory and returns PEM only on the transport', async () => {
  const calls: FakeCall[] = [];
  const api = fakeApiServer({ '192.0.2.50': 'uid-c1' });
  let transport: Awaited<ReturnType<typeof runAdapter>>;
  try {
    transport = await runAdapter(
      connection,
      baoGet(JSON.stringify({ data: { data: { kubeconfig: kubeconfigYaml } } })),
      calls,
    );
  } finally {
    api.restore();
  }
  expect(api.seen).toEqual(['GET 192.0.2.50/api/v1/namespaces/kube-system']);
  expect(calls.map((call) => call.command)).toEqual(['bao']);
  expect(calls[0]?.args[1]).toBe('get');
  expect(calls[0]?.stdin).toBeUndefined();
  expect(transport.endpoint).toBe('https://192.0.2.50:6443');
  expect(transport.clientCert?.certificate).toContain('BEGIN CERTIFICATE');
  expect(transport.clientCert?.key).toContain('PRIVATE KEY');
  expect(await Effect.runPromise(transport.headers)).toEqual({});
  expect(JSON.stringify(connection)).not.toContain('BEGIN CERTIFICATE');
});

const absent = () => ({ exitCode: 2, stderr: 'No value found at talos-c1/data/kubeconfig' });

test('a missing key on a live cluster is the loud TalosVaultKeyMissing, not ClusterNotFound', async () => {
  const message = await runDirect(
    connectTalosOpenBao(config, connection).pipe(
      Effect.catchTag('TalosVaultKeyMissing', (error) => Effect.succeed(error.message)),
    ),
    absent,
  );
  expect(message).toContain('talos-c1/kubeconfig');
  expect(message).not.toContain('BEGIN CERTIFICATE');
  let caught: unknown;
  try {
    await runAdapter(connection, absent);
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeInstanceOf(ClusterNotFoundError);
  expect(String(caught)).toContain('talos-c1/kubeconfig');
});

test('a missing key on a retired cluster is ClusterNotFoundError', async () => {
  const retired = { c1: { ...config.c1, retired: true } };
  const message = await runDirect(
    connectTalosOpenBao(retired, connection).pipe(
      Effect.catchTag('Kubernetes.ClusterNotFoundError', (error) => Effect.succeed(error.message)),
    ),
    absent,
  );
  expect(message).toContain('talos-c1/kubeconfig');
  expect(message).not.toContain('BEGIN CERTIFICATE');
});

test('a vault denial is not reported as a missing key', async () => {
  let caught: unknown;
  try {
    await runDirect(connectTalosOpenBao(config, connection), () => ({
      exitCode: 1,
      stderr: 'permission denied',
    }));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(ClusterNotFoundError);
  expect(String(caught)).toContain('permission denied');
  expect(String(caught)).toContain('talos-c1/kubeconfig');
});

test('an unreadable document fails without echoing PEM', async () => {
  const secret = `${beginLine('PRIVATE KEY')}\nnot-a-document\n`;
  const message = await runDirect(
    connectTalosOpenBao(config, connection).pipe(
      Effect.catchTag('TalosKubeconfigUnreadable', (error) => Effect.succeed(error.message)),
    ),
    baoGet(JSON.stringify({ data: { data: { kubeconfig: secret } } })),
  );
  expect(message).toContain('talos-c1/kubeconfig');
  expect(message).toContain('admin@hf-c1');
  expect(message).not.toContain('PRIVATE KEY');
});

test('a different auth kind never calls bao', async () => {
  const calls: FakeCall[] = [];
  const message = await runDirect(
    connectTalosOpenBao(config, { auth: { kind: 'token', token: 'not-a-token' } }).pipe(
      Effect.catchTag('TalosOpenBaoAuthKind', (error) => Effect.succeed(error.message)),
    ),
    baoGet('{}'),
    calls,
  );
  expect(message).toContain('token');
  expect(calls).toEqual([]);
});
