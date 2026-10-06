/**
 * `Talos.ClusterIdentity` — a read-only resource that reports WHICH physical cluster a name means.
 *
 * ★ It reads the vault kubeconfig and GETs the kube-system Namespace once (`cluster-identity.ts`),
 *   and publishes `{ uid, connection }`. Workloads take `cluster: identity`, so the auth block they
 *   persist is `{ kind: 'talos-openbao', uid }` and the adapter can refuse any other cluster at
 *   connect (cluster-adapter.ts's identity rule).
 * ⛔ IT MUTATES NOTHING: no vault write, no cluster write, `delete` is a no-op. Its only effect is
 *   the value it reports. `after` must reach past Cilium/CNI only if the apiserver needs it; the
 *   kube-system namespace exists as soon as the apiserver answers.
 * ⛔ A CHANGED UID IS REFUSED, NEVER AN UPDATE (`TalosClusterMoved`, in diff AND reconcile). This
 *   resource declares no `stables`, so downstream the engine sees an unresolved Output, every
 *   workload `diff` returns undefined and the engine plans an UPDATE, not a replace (Plan.ts
 *   resourceExpr, `isResolved(news)` in Manifest.ts and HelmChart.ts). Reconcile would then
 *   connect with the NEW uid and force-apply onto the new cluster while the old cluster's objects
 *   are orphaned (an earlier comment here claimed a replace and a refusal at cleanup: it cannot
 *   happen). A real move is a NEW identity resource per physical cluster.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type TalosOpenBaoConnection, talosOpenBaoConnection } from './cluster-adapter.ts';
import { TalosClusterMoved } from './cluster-adapter-errors.ts';
import { readClusterUid } from './cluster-identity.ts';
import { openTransport, talosVaultLocation } from './cluster-transport.ts';
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
  /** `{ kind, uid }`. Makes these attributes `ClusterLike`. */
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
    const transport = yield* openTransport(talosVaultLocation(props));
    const uid = yield* readClusterUid(cluster, transport);
    return { connection: talosOpenBaoConnection(uid), uid };
  });

/** ⛔ Fails closed when a saved uid exists and the live one differs. See the header. */
export const reconcileClusterIdentity = (
  props: ClusterIdentityProps,
  output: ClusterIdentityAttributes | undefined,
) =>
  Effect.gen(function* () {
    const live = yield* readClusterIdentity(props);
    if (output !== undefined && live.uid !== output.uid) {
      return yield* Effect.fail(
        new TalosClusterMoved({ cluster: props.target.cluster, live: live.uid, saved: output.uid }),
      );
    }
    return live;
  });

export const diffClusterIdentity = (
  news: Input<ClusterIdentityProps>,
  output: ClusterIdentityAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    yield* reconcileClusterIdentity(news, output);
    return { action: 'noop' } as const;
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
  reconcile: ({
    news,
    output,
  }: {
    news: ClusterIdentityProps;
    output: ClusterIdentityAttributes | undefined;
  }) => reconcileClusterIdentity(news, output),
};

export const TalosClusterIdentityProvider = () =>
  Provider.effect(TalosClusterIdentity, Effect.succeed(TalosClusterIdentity.Provider.of(handlers)));
