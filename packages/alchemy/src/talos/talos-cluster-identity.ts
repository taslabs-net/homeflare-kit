/**
 * `Talos.ClusterIdentity` — a read-only resource that reports WHICH physical cluster a name means.
 *
 * ★ It reads the vault kubeconfig and GETs the kube-system Namespace once (`cluster-identity.ts`),
 *   and publishes `{ uid, connection }`. Workloads take `cluster: identity`, so the auth block they
 *   persist is `{ kind: 'talos-openbao', cluster, uid }` and the adapter can refuse any other
 *   cluster at connect (cluster-adapter.ts's identity rule).
 * ⛔ IT MUTATES NOTHING: no vault write, no cluster write, `delete` is a no-op. Its only effect is
 *   the value it reports. `after` must reach past Cilium/CNI only if the apiserver needs it; the
 *   kube-system namespace exists as soon as the apiserver answers.
 * ⚠️ A REAL MOVE (the name now answers as another cluster) updates `uid`, which changes every
 *   dependent workload's auth block. Upstream then plans `replace`; the old row's cleanup
 *   reconnects with the OLD uid and the adapter refuses it. That is the intended fail-closed stop:
 *   the deploy errors instead of deleting same-named objects on the new cluster.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type TalosOpenBaoConnection, talosOpenBaoConnection } from './cluster-adapter.ts';
import { readClusterUid } from './cluster-identity.ts';
import { openTransport, talosOpenBaoCluster } from './cluster-transport.ts';
import type { KubeconfigProps } from './kubeconfig.ts';
import type { TalosRequirements } from './resource.ts';

type KubeconfigSource = Pick<KubeconfigProps, 'context' | 'kubeconfigKey' | 'target'>;

export interface ClusterIdentityProps extends KubeconfigSource {
  /** Ordering edge: after `Talos.Kubeconfig` (the vault key must exist) and the apiserver is up. */
  after?: readonly unknown[];
}

export interface ClusterIdentityAttributes {
  /** The cluster's kube-system `metadata.uid`. Public. */
  uid: string;
  /** `{ kind, cluster, uid }`. Makes these attributes `ClusterLike`. */
  connection: TalosOpenBaoConnection;
}

export interface TalosClusterIdentity extends Resource<
  'Talos.ClusterIdentity',
  ClusterIdentityProps,
  ClusterIdentityAttributes,
  never,
  TalosRequirements
> {}

export const TalosClusterIdentity = Resource<TalosClusterIdentity>('Talos.ClusterIdentity');

/** ★ EXPORTED for talos-cluster-identity.test.ts — see talos-bootstrap.ts's note on the pattern. */
export const readClusterIdentity = (props: ClusterIdentityProps) =>
  Effect.gen(function* () {
    const cluster = props.target.cluster;
    const transport = yield* openTransport(talosOpenBaoCluster(props));
    const uid = yield* readClusterUid(cluster, transport);
    return { connection: talosOpenBaoConnection(cluster, uid), uid };
  });

export const diffClusterIdentity = (
  news: Input<ClusterIdentityProps>,
  output: ClusterIdentityAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readClusterIdentity(news);
    const same =
      live.uid === output.uid && live.connection.auth.cluster === output.connection.auth.cluster;
    return same ? ({ action: 'noop' } as const) : ({ action: 'update' } as const);
  });

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<ClusterIdentityProps>;
    output: ClusterIdentityAttributes | undefined;
  }) => diffClusterIdentity(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ClusterIdentityProps }) => readClusterIdentity(olds),
  reconcile: ({ news }: { news: ClusterIdentityProps }) => readClusterIdentity(news),
};

export const TalosClusterIdentityProvider = () =>
  Provider.effect(TalosClusterIdentity, Effect.succeed(TalosClusterIdentity.Provider.of(handlers)));
