/**
 * `Talos.ClusterIdentity` — publishes the physical cluster's uid as the connection workloads
 * carry. Fake `bao` and fake apiserver only; nothing is written.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { fakeApiServer } from './fake-apiserver.ts';
import { fakeSpawner } from './fake-process.ts';
import { diffClusterIdentity, readClusterIdentity } from './talos-cluster-identity.ts';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const pem = (label: string) => `-----${'BEGIN'} ${label}-----\n${b64(label)}\n`;
const kubeconfig = `apiVersion: v1
kind: Config
clusters:
  - name: c1
    cluster: { server: 'https://c1.cluster.invalid:6443', certificate-authority-data: ${b64(pem('CERTIFICATE'))} }
contexts:
  - name: admin@c1
    context: { cluster: c1, user: admin@c1 }
users:
  - name: admin@c1
    user: { client-certificate-data: ${b64(pem('CERTIFICATE'))}, client-key-data: ${b64(pem('PRIVATE KEY'))} }
`;
const props = { context: 'admin@c1', target: { cluster: 'c1', mount: 'talos-c1' } };
const run = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(() => ({ stdout: JSON.stringify({ data: { data: { kubeconfig } } }) })),
    ),
  );

test('reads the kube-system uid and publishes { kind, cluster, uid }', async () => {
  const api = fakeApiServer({ 'c1.cluster.invalid': 'uid-c1' });
  try {
    const out = await run(readClusterIdentity(props));
    expect(out).toEqual({
      connection: { auth: { cluster: 'c1', kind: 'talos-openbao', uid: 'uid-c1' } },
      uid: 'uid-c1',
    });
    expect(api.seen).toEqual(['GET c1.cluster.invalid/api/v1/namespaces/kube-system']);
  } finally {
    api.restore();
  }
});

test('a name that now answers as another cluster plans update, an unchanged one noop', async () => {
  const prior = {
    connection: { auth: { cluster: 'c1', kind: 'talos-openbao', uid: 'uid-c1' } },
    uid: 'uid-c1',
  } as const;
  const api = fakeApiServer({ 'c1.cluster.invalid': 'uid-c1' });
  try {
    expect((await run(diffClusterIdentity(props, prior)))?.action).toBe('noop');
  } finally {
    api.restore();
  }
  const moved = fakeApiServer({ 'c1.cluster.invalid': 'uid-c2' });
  try {
    expect((await run(diffClusterIdentity(props, prior)))?.action).toBe('update');
  } finally {
    moved.restore();
  }
});

test('an apiserver answering without a uid fails closed', async () => {
  const api = fakeApiServer({});
  try {
    const failure = await run(readClusterIdentity(props)).catch((e: unknown) => String(e));
    expect(failure).toContain('TalosClusterIdentityUnreadable');
  } finally {
    api.restore();
  }
});
