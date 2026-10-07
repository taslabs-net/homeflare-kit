/**
 * `Talos.ClusterIdentity` — publishes the physical cluster's uid for the operator to pin. Fake `bao` and fake apiserver only; nothing is written.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { fakeApiServer } from './fake-apiserver.ts';
import { fakeSpawner } from './fake-process.ts';
import {
  diffClusterIdentity,
  readClusterIdentity,
  reconcileClusterIdentity,
} from './talos-cluster-identity.ts';

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

test('reads the kube-system uid and publishes { uid }', async () => {
  const api = fakeApiServer({ 'c1.cluster.invalid': 'uid-c1' });
  try {
    const out = await run(readClusterIdentity(props));
    expect(out).toEqual({ uid: 'uid-c1' });
    expect(api.seen).toEqual(['GET c1.cluster.invalid/api/v1/namespaces/kube-system']);
  } finally {
    api.restore();
  }
});

const prior = { uid: 'uid-c1' } as const;

test('an unchanged uid is a noop', async () => {
  const api = fakeApiServer({ 'c1.cluster.invalid': 'uid-c1' });
  try {
    expect((await run(diffClusterIdentity(props, prior)))?.action).toBe('noop');
  } finally {
    api.restore();
  }
});

// ⛔ A changed uid must never be an `update`: downstream workloads would be force-applied onto the
//   new cluster (see the header of talos-cluster-identity.ts).
test('a changed uid is refused in diff AND reconcile, never an update', async () => {
  const moved = fakeApiServer({ 'c1.cluster.invalid': 'uid-c2' });
  try {
    const inDiff = await run(diffClusterIdentity(props, prior)).catch((e: unknown) => String(e));
    expect(inDiff).toContain('TalosClusterMoved');
    expect(inDiff).toContain('uid-c2');
    const inReconcile = await run(reconcileClusterIdentity(props, prior)).catch((e: unknown) =>
      String(e),
    );
    expect(inReconcile).toContain('TalosClusterMoved');
  } finally {
    moved.restore();
  }
});

test('reconcile with no saved output publishes the live uid', async () => {
  const api = fakeApiServer({ 'c1.cluster.invalid': 'uid-c2' });
  try {
    const out = await run(reconcileClusterIdentity(props, undefined));
    expect(out.uid).toBe('uid-c2');
  } finally {
    api.restore();
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
