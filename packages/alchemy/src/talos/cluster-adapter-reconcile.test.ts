/**
 * `Kubernetes.Manifest` and `Kubernetes.HelmChart` THROUGH the registered `talos-openbao` adapter,
 * with a fake `bao` and a fake apiserver (`fake-apiserver.ts` — no socket, no vault, no cluster).
 * Proves the per-cluster config (each connection reaches its own endpoint, an unconfigured uid
 * is refused, a retired cluster's delete is a no-op) and the IDENTITY RULE (cluster-adapter.ts):
 * a saved row whose uid-pinned entry was repointed at another physical cluster is refused with NO
 * request sent to either, while a matching uid still works and a missing uid fails closed.
 * The alias-rename and engine-level cases live in cluster-adapter-rename.test.ts.
 */
import { expect, test } from 'bun:test';
import type { Manifest } from 'alchemy/Kubernetes/Manifest';
import type * as Provider from 'alchemy/Provider';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import {
  UIDS,
  config,
  failure,
  helmApi,
  helmRow,
  manifestApi,
  manifestRow,
  session,
} from './cluster-adapter.fixtures.ts';
import { fakeApiServer } from './fake-apiserver.ts';

test('two clusters in one stack each reach their own endpoint, uid-checked first', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const reconcile = (cluster: string, uid: string) => (s: Provider.ProviderService<Manifest>) =>
      s.reconcile({
        news: {
          cluster: talosOpenBaoConnection(uid),
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
      '{"auth":{"kind":"talos-openbao","uid":"uid-c1"}}',
    );
  } finally {
    api.restore();
  }
});

test('a connection naming an unconfigured uid is refused before any request', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const message = await failure(() =>
      manifestApi((s) => s.delete({ output: manifestRow({ uid: 'uid-c9' }) } as never)),
    );
    expect(message).toContain('no entry pinned to cluster uid uid-c9');
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});

test('delete on a retired cluster is a no-op, on a live one it reaches that cluster only', async () => {
  const api = fakeApiServer(UIDS);
  try {
    await manifestApi((s) => s.delete({ output: manifestRow({ uid: 'uid-gone' }) } as never));
    expect(api.seen).toEqual([]);
    await manifestApi((s) =>
      s.delete({ output: manifestRow({ uid: 'uid-c2' }, 'ns-c2') } as never),
    );
    expect(api.seen).toEqual([
      'GET c2.cluster.invalid/api/v1/namespaces/kube-system',
      'DELETE c2.cluster.invalid/api/v1/namespaces/ns-c2',
    ]);
  } finally {
    api.restore();
  }
});

// ★ THE CODEX SCENARIO: create with c1's config, then repoint the entry pinned to uid-c1 at c2's
//   vault key and delete the saved output. Before the identity rule that sent DELETE to c2.
const repointed = { ...config, c1: { ...config.c2, uid: 'uid-c1' } };

test('a saved c1 row is refused when its entry now points at c2: no request reaches either', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const row = manifestRow({ uid: 'uid-c1' });
    const message = await failure(() =>
      manifestApi((s) => s.delete({ output: row } as never), repointed),
    );
    expect(message).toContain('TalosClusterIdentityMismatch');
    expect(message).toContain('uid-c2');
    expect(api.seen).toEqual(['GET c2.cluster.invalid/api/v1/namespaces/kube-system']);
  } finally {
    api.restore();
  }
});

test('the same repoint refuses a Manifest read and a HelmChart cleanup: no write reaches either', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const read = await failure(() =>
      manifestApi(
        (s) => s.read?.({ output: manifestRow({ uid: 'uid-c1' }) } as never) as never,
        repointed,
      ),
    );
    expect(read).toContain('TalosClusterIdentityMismatch');
    const cleanup = await failure(() =>
      helmApi((s) => s.delete({ output: helmRow({ uid: 'uid-c1' }) } as never), repointed),
    );
    expect(cleanup).toContain('TalosClusterIdentityMismatch');
    expect(api.seen.filter((call) => !call.startsWith('GET '))).toEqual([]);
    expect(api.seen.every((call) => call.startsWith('GET c2.'))).toBe(true);
  } finally {
    api.restore();
  }
});

test('a matching uid still deletes on the right cluster (Manifest and HelmChart)', async () => {
  const api = fakeApiServer(UIDS);
  try {
    await manifestApi((s) => s.delete({ output: manifestRow({ uid: 'uid-c1' }) } as never));
    await helmApi((s) => s.delete({ output: helmRow({ uid: 'uid-c1' }) } as never));
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
      manifestApi((s) => s.delete({ output: manifestRow({}) } as never)),
    );
    expect(message).toContain('TalosClusterIdentityMissing');
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});

test('a legacy row with auth.cluster is refused with no request and a remedy', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const message = await failure(() =>
      manifestApi((s) =>
        s.delete({ output: manifestRow({ cluster: 'c1', uid: 'uid-c1' }) } as never),
      ),
    );
    expect(message).toContain('TalosOpenBaoLegacyAuth');
    expect(message).toContain('edit the saved state');
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});
