/**
 * Renaming adapter configuration must be a no-op for upstream workloads, THROUGH the real
 * `ManifestProvider` and `HelmChartProvider` with the fake apiserver. Upstream hashes only the auth
 * block (`internal/workload.ts:91-96` `connectionIdentity`) and replaces on a difference, and a
 * replace PATCHes then DELETEs the same-named object. The auth block is `{ kind, uid }`, so an
 * alias, vault key, mount or context rename must change nothing it hashes.
 *
 * ⚠️ The engine-level plan (Plan.ts) is not driven here: it needs a state store, a stack and the
 *   full alchemy runtime. What decides replace-versus-update is the provider `diff` result, which
 *   is asserted directly; the engine only maps `undefined` to update and `replace` to a recreate.
 */
import { expect, test } from 'bun:test';
import type { Manifest } from 'alchemy/Kubernetes/Manifest';
import type * as Provider from 'alchemy/Provider';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import { UIDS, manifestApi, session } from './cluster-adapter.fixtures.ts';
import { fakeApiServer } from './fake-apiserver.ts';

const props = (uid: string) => ({
  cluster: talosOpenBaoConnection(uid),
  manifest: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'ns-c1' } },
});
const only = (calls: readonly string[], method: string) =>
  calls.filter((call) => call.startsWith(`${method} `));

/** Same physical cluster (uid-c1), every piece of configuration the old config named renamed. */
const renamed = {
  moved: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
};

test('an alias rename plans no replace and sends no DELETE; update and delete reach c1 only', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const out = (await manifestApi((s: Provider.ProviderService<Manifest>) =>
      s.reconcile({ news: props('uid-c1'), olds: undefined, output: undefined, session } as never),
    )) as { connection: unknown };
    api.seen.length = 0;

    const diff = await manifestApi(
      (s) =>
        s.diff?.({
          news: props('uid-c1'),
          olds: props('uid-c1'),
          output: out,
        } as never) as never,
      renamed,
    );
    expect(diff).toBeUndefined();
    expect(api.seen).toEqual([]);

    await manifestApi(
      (s) =>
        s.reconcile({
          news: props('uid-c1'),
          olds: props('uid-c1'),
          output: out,
          session,
        } as never),
      renamed,
    );
    await manifestApi((s) => s.delete({ output: out } as never), renamed);
    expect(only(api.seen, 'DELETE')).toEqual(['DELETE c1.cluster.invalid/api/v1/namespaces/ns-c1']);
    expect(api.seen.filter((call) => !call.includes('c1.cluster.invalid'))).toEqual([]);
    expect(only(api.seen, 'PATCH')).toHaveLength(1);
    expect(JSON.stringify(out.connection)).toBe('{"auth":{"kind":"talos-openbao","uid":"uid-c1"}}');
  } finally {
    api.restore();
  }
});

test('a real move (a different uid) is a replace, never an in-place update', async () => {
  const api = fakeApiServer(UIDS);
  try {
    const diff = await manifestApi(
      (s) =>
        s.diff?.({
          news: props('uid-c2'),
          olds: props('uid-c1'),
          output: undefined,
        } as never) as never,
    );
    expect(diff).toEqual({ action: 'replace' });
    expect(api.seen).toEqual([]);
  } finally {
    api.restore();
  }
});
