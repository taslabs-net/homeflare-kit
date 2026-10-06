/**
 * `Kubernetes.ClusterAdapter` kind `talos-openbao`.
 *
 * Reads `mount/key` from OpenBao at connect time (`credentials.ts`'s `readKvValue`, which
 * shells to `bao` with BAO_ADDR/BAO_TOKEN) and returns a `ClusterTransport`.
 * ⛔ NOTHING IS WRITTEN TO DISK. ⛔ THE PERSISTED CONNECTION IS `{ kind, cluster, uid }` ONLY.
 *   alchemy `Kubernetes/Connection.ts` (v2.0.0-beta.79, lines 12-14) stores the Connection on
 *   every workload's attributes, so the upstream `client-cert` kind would put the admin PEM in
 *   the shared state store. The stock `kubeconfig` kind is also refused: an empty path falls
 *   back to `$KUBECONFIG`.
 * ⛔ mount/key/context LIVE IN THE ADAPTER'S CONFIGURATION, NOT IN THE AUTH BLOCK. Upstream
 *   compares clusters by the auth block (`internal/workload.ts:91-96` `connectionIdentity`) and
 *   HelmChart/Manifest answer `replace` when it changes (`HelmChart.ts:248-258`,
 *   `Manifest.ts:194-209`); a replace creates first, then cleanup deletes the SAME-named objects.
 *   Renaming a vault key would silently delete Cilium, External Secrets and Gatekeeper.
 * ⛔ THE IDENTITY RULE: THE AUTH BLOCK NAMES THE PHYSICAL CLUSTER. `uid` is the kube-system
 *   Namespace `metadata.uid` (public, stable across CA rotation). read/update/delete all
 *   reconnect from the SAVED auth block (`Manifest.ts:214` and `:267`, `HelmChart.ts:322` and
 *   `:335`, via `connectionOfOutput`, `internal/workload.ts:104-108`) while the cluster NAME
 *   resolves through today's MUTABLE config: repoint `c1` at c2's vault key and a saved `c1` row
 *   PATCHes one cluster and DELETEs on another (reproduced through ManifestProvider). So `connect`
 *   fails closed BEFORE any vault read when the auth block has no uid, then GETs kube-system and
 *   compares before returning a transport: a missing, unreadable or different uid is a typed
 *   error — never `ClusterNotFoundError`, which upstream turns into a silent no-op. The stack
 *   obtains the uid as an Output of `Talos.ClusterIdentity`, so a REAL move to another cluster
 *   changes the auth block and upstream replaces instead of deleting on the wrong cluster.
 *   Cost: one extra GET per connect.
 *
 * Walked against alchemy 2.0.0-beta.79 `ClusterAdapter.ts` / `BuiltinAdapters.ts` and the OpenBao
 * v2.6.2 absence string in `isVaultKeyAbsent`. Fake `bao` and fake apiserver only.
 */
import {
  ClusterAdapter,
  type ClusterAdapterService,
  type ClusterNotFoundError,
  type ClusterTransport,
} from 'alchemy/Kubernetes/ClusterAdapter';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import {
  type TalosClusterIdentityMismatch,
  TalosClusterIdentityMissing,
  type TalosClusterIdentityUnreadable,
  type TalosKubeconfigUnreadable,
  TalosOpenBaoAuthKind,
  TalosOpenBaoUnknownCluster,
  type TalosVaultKeyMissing,
} from './cluster-adapter-errors.ts';
import { assertClusterUid } from './cluster-identity.ts';
import { type TalosOpenBaoCluster, openTransport } from './cluster-transport.ts';

export {
  TalosClusterIdentityMismatch,
  TalosClusterIdentityMissing,
  TalosClusterIdentityUnreadable,
  TalosKubeconfigUnreadable,
  TalosOpenBaoAuthKind,
  TalosOpenBaoUnknownCluster,
  TalosVaultKeyMissing,
} from './cluster-adapter-errors.ts';
export { type TalosOpenBaoCluster, talosOpenBaoCluster } from './cluster-transport.ts';

declare module 'alchemy/Kubernetes/Connection' {
  interface AuthRegistry {
    /**
     * Admin kubeconfig in OpenBao KV, read when a workload connects. Contributed by
     * {@link TalosOpenBaoAdapter}, which holds the mount, key and context.
     */
    'talos-openbao': {
      /** Logical cluster name, e.g. `c1`. Selects the adapter's vault configuration. */
      cluster: string;
      /**
       * The cluster's kube-system `metadata.uid`. Required at connect: absent means refused.
       * Typed optional only so a row saved before this field existed still deserializes.
       */
      uid?: string;
    };
  }
}

/**
 * ⛔ KEYED BY CLUSTER NAME, the `cluster` in the persisted connection. One adapter serves every
 *   cluster in a stack; `connect` looks the cluster up and refuses an unknown one
 *   ({@link TalosOpenBaoUnknownCluster}) instead of reading some other cluster's kubeconfig.
 */
export type TalosOpenBaoConfig = Readonly<Record<string, TalosOpenBaoCluster>>;

/** A `Connection` narrowed to this kind, so a PEM-bearing connection cannot be stored by type. */
export type TalosOpenBaoConnection = Connection & {
  readonly auth: { readonly kind: 'talos-openbao'; readonly cluster: string; readonly uid: string };
};

/** Serializable connection: kind, cluster name and uid. No vault path, endpoint, CA or cert. */
export const talosOpenBaoConnection = (cluster: string, uid: string): TalosOpenBaoConnection => ({
  auth: { kind: 'talos-openbao', cluster, uid },
});

/**
 * Resolve one `talos-openbao` connection to a transport. Requires `ChildProcessSpawner`
 * because the vault read shells to `bao`, and reaches the apiserver once for the identity check.
 *
 * ⚠️ A key the vault reports absent is `ClusterNotFoundError` ONLY for a cluster configured
 *   `retired: true` (upstream `read`/`delete` treat that as "everything in-cluster is already
 *   gone", so tearing down a destroyed cluster is not stuck). Otherwise it is the typed
 *   `TalosVaultKeyMissing`. Neither message names document bytes.
 */
export const connectTalosOpenBao = (
  configs: TalosOpenBaoConfig,
  connection: Connection,
): Effect.Effect<
  ClusterTransport,
  | TalosOpenBaoAuthKind
  | TalosOpenBaoUnknownCluster
  | TalosClusterIdentityMissing
  | TalosClusterIdentityMismatch
  | TalosClusterIdentityUnreadable
  | TalosVaultKeyMissing
  | ClusterNotFoundError
  | TalosKubeconfigUnreadable
  | Error,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const { auth } = connection;
    if (auth.kind !== 'talos-openbao') {
      return yield* Effect.fail(new TalosOpenBaoAuthKind({ kind: auth.kind }));
    }
    const { cluster, uid } = auth;
    const config = Object.hasOwn(configs, cluster) ? configs[cluster] : undefined;
    if (config === undefined) {
      return yield* Effect.fail(
        new TalosOpenBaoUnknownCluster({ cluster, known: Object.keys(configs) }),
      );
    }
    // ⛔ Before the vault is touched: a row with no identity can only be refused, never guessed.
    if (typeof uid !== 'string' || uid === '') {
      return yield* Effect.fail(new TalosClusterIdentityMissing({ cluster }));
    }
    const transport = yield* openTransport(config);
    yield* assertClusterUid(cluster, uid, transport);
    return transport;
  });

/**
 * Register kind `talos-openbao`. Merge with `Kubernetes.providers()`:
 * `Layer.mergeAll(Kubernetes.providers(), TalosOpenBaoAdapter({ c1: talosOpenBaoCluster(kc1) }))`
 * where `kc1` is the props object handed to `Talos.Kubeconfig`.
 */
export const TalosOpenBaoAdapter = (
  config: TalosOpenBaoConfig,
): Layer.Layer<ClusterAdapterService, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    ClusterAdapter('talos-openbao'),
    Effect.gen(function* () {
      const context = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
      const service: ClusterAdapterService = {
        kind: 'Kubernetes.ClusterAdapter',
        connect: (connection) =>
          connectTalosOpenBao(config, connection).pipe(Effect.provideContext(context)),
      };
      return service;
    }),
  );
