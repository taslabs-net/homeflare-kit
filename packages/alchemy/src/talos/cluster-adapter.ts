/**
 * `Kubernetes.ClusterAdapter` kind `talos-openbao`.
 *
 * Reads `mount/key` from OpenBao at connect time (`credentials.ts`'s `readKvValue`, which
 * shells to `bao` with BAO_ADDR/BAO_TOKEN) and returns a `ClusterTransport`.
 * ⛔ NOTHING IS WRITTEN TO DISK. ⛔ THE PERSISTED CONNECTION IS `{ kind, uid }` ONLY.
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
 *   `:335`, via `connectionOfOutput`, `internal/workload.ts:104-108`). A cluster NAME resolved
 *   through today's MUTABLE config would let a repointed `c1` PATCH one cluster and DELETE on
 *   another (reproduced through ManifestProvider). So the auth block carries the uid and NOTHING
 *   else: the config entry is looked up BY uid (no probing walk), `connect` fails closed BEFORE
 *   any vault read when the uid is absent or the row is legacy (`auth.cluster`), then GETs
 *   kube-system and compares before returning a transport. Missing, unreadable, unknown or
 *   different uid is a typed error — never `ClusterNotFoundError` (except a `retired` entry's
 *   absent key), which upstream turns into a silent no-op. Cost: one extra GET per connect.
 * ⛔ BOOTSTRAP-THEN-PIN. A brand-new cluster has no uid until it exists, and an Output uid is
 *   forbidden (`talosOpenBaoConnection`). So: (1) the first deploy creates the cluster and
 *   `Talos.ClusterIdentity` (which reads and outputs the uid) with NO workloads; (2) the operator
 *   pins that printed uid literal in this adapter's config; (3) workloads deploy afterwards with
 *   `talosOpenBaoConnection(<that literal>)`. A uid that is not pinned is refused at connect.
 * ⚠️ A REAL MOVE IS NOT AN AUTOMATIC REPLACE. `Talos.ClusterIdentity` refuses a changed uid
 *   (`TalosClusterMoved`); a move is a NEW identity resource per physical cluster, so the old
 *   rows keep their old uid and their cleanup reaches only the old cluster.
 * ⛔ ONE 10 s DEADLINE covers the vault read AND the uid GET (`withConnectDeadline`): a hung `bao`
 *   or silent apiserver fails with `TalosOpenBaoConnectTimeout` and the `bao` child is killed.
 *   ⚠️ The in-flight HTTPS GET is NOT aborted: upstream `readObject` takes no signal
 *   (`internal/client.ts:75`), so the socket lives until the OS gives up. Left for the upstream ask.
 *
 * USAGE RULES (upstream behaviour this adapter cannot fix; full text in
 * `docs/talos-openbao-adapter.md`):
 *   1. Move a workload to another cluster ONLY by new logical IDs (destroy + create), never by
 *      changing its connection in place.
 *   2. Manage namespaces as separate `Manifest`s, never HelmChart `createNamespace`.
 *   3. Never rename a HelmChart `releaseName` in place.
 *
 * Walked against alchemy 2.0.0-beta.79 `ClusterAdapter.ts` / `BuiltinAdapters.ts` and the OpenBao
 * v2.6.2 absence string in `isVaultKeyAbsent`. Fake `bao` and fake apiserver only.
 */
import {
  ClusterAdapter,
  type ClusterAdapterService,
  ClusterNotFoundError,
  type ClusterTransport,
} from 'alchemy/Kubernetes/ClusterAdapter';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import {
  type TalosClusterIdentityMismatch,
  TalosClusterIdentityMissing,
  type TalosClusterIdentityTimeout,
  type TalosClusterIdentityUnreadable,
  type TalosKubeconfigUnreadable,
  TalosOpenBaoAmbiguousUid,
  TalosOpenBaoAuthKind,
  type TalosOpenBaoConnectTimeout,
  TalosOpenBaoLegacyAuth,
  TalosOpenBaoUnknownCluster,
  TalosUidNotLiteral,
  type TalosVaultKeyMissing,
} from './cluster-adapter-errors.ts';
import { assertClusterUid } from './cluster-identity.ts';
import {
  CONNECT_TIMEOUT,
  type TalosOpenBaoCluster,
  openTransport,
  withConnectDeadline,
} from './cluster-transport.ts';

export {
  TalosClusterIdentityMismatch,
  TalosClusterIdentityMissing,
  TalosClusterIdentityTimeout,
  TalosClusterIdentityUnreadable,
  TalosClusterMoved,
  TalosKubeconfigUnreadable,
  TalosOpenBaoAmbiguousUid,
  TalosOpenBaoAuthKind,
  TalosOpenBaoConnectTimeout,
  TalosOpenBaoLegacyAuth,
  TalosOpenBaoUnknownCluster,
  TalosUidNotLiteral,
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
      /**
       * The cluster's kube-system `metadata.uid`: the ONLY identity, a LITERAL string known at
       * plan time (never an Output, see {@link talosOpenBaoConnection}). A row saved before it
       * existed has none at runtime and is refused at connect.
       */
      uid: string;
    };
  }
}

/**
 * ⛔ KEYED BY ALIAS, BUT THE ALIAS IS NEVER PERSISTED OR LOOKED UP BY. `connect` finds the entry
 *   whose pinned `uid` equals the saved auth block's, so renaming an alias changes nothing upstream
 *   hashes. Unknown uid is {@link TalosOpenBaoUnknownCluster}: refused, not another cluster's key.
 */
export type TalosOpenBaoConfig = Readonly<Record<string, TalosOpenBaoCluster>>;

/** A `Connection` narrowed to this kind, so a PEM-bearing connection cannot be stored by type. */
export type TalosOpenBaoConnection = Connection & {
  readonly auth: { readonly kind: 'talos-openbao'; readonly uid: string };
};

/**
 * Serializable connection: kind and uid. No alias, vault path, endpoint, CA or cert.
 * ⛔ THE UID MUST BE A LITERAL. An Output (a resource attribute such as `Talos.ClusterIdentity`'s)
 *   is unresolved at plan time, so `isResolved(news)` is false, upstream plans an UPDATE (Plan.ts)
 *   and reconcile replays the OLD cluster's `previousObjects` as deletes on the NEW cluster
 *   (reproduced: DELETE on B). Take the uid from the pinned adapter entry: a changed literal is a
 *   changed auth block, which upstream answers with `replace`. Anything else throws
 *   {@link TalosUidNotLiteral} while the stack is being declared.
 */
export const talosOpenBaoConnection = (uid: string): TalosOpenBaoConnection => {
  if (typeof uid !== 'string' || uid === '') throw new TalosUidNotLiteral({});
  return { auth: { kind: 'talos-openbao', uid } };
};

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
  timeout: Duration.Duration = CONNECT_TIMEOUT,
): Effect.Effect<
  ClusterTransport,
  | TalosOpenBaoAuthKind
  | TalosOpenBaoUnknownCluster
  | TalosOpenBaoAmbiguousUid
  | TalosOpenBaoLegacyAuth
  | TalosClusterIdentityMissing
  | TalosClusterIdentityMismatch
  | TalosClusterIdentityUnreadable
  | TalosClusterIdentityTimeout
  | TalosOpenBaoConnectTimeout
  | TalosVaultKeyMissing
  | ClusterNotFoundError
  | TalosKubeconfigUnreadable
  | Error,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    // ⛔ FAIL CLOSED BEFORE ANY DESTRUCTURING: a saved row missing its whole connection, or just
    //   its auth block, names no physical cluster — a typed refusal, never a raw TypeError.
    if (connection === undefined || connection === null) {
      return yield* Effect.fail(new TalosClusterIdentityMissing({}));
    }
    const { auth } = connection;
    if (auth === undefined || auth === null) {
      return yield* Effect.fail(new TalosClusterIdentityMissing({}));
    }
    if (auth.kind !== 'talos-openbao') {
      return yield* Effect.fail(new TalosOpenBaoAuthKind({ kind: auth.kind }));
    }
    // ⛔ Before the vault is touched. A row saved with an alias is refused even if it also has a
    //   uid: no silent migration, the saved state is edited deliberately (the error says how).
    if (Object.hasOwn(auth, 'cluster')) {
      return yield* Effect.fail(new TalosOpenBaoLegacyAuth({}));
    }
    const { uid } = auth;
    if (typeof uid !== 'string' || uid === '') {
      return yield* Effect.fail(new TalosClusterIdentityMissing({}));
    }
    const matches = Object.entries(configs).filter(([, entry]) => entry.uid === uid);
    const [match] = matches;
    if (match === undefined) {
      return yield* Effect.fail(
        new TalosOpenBaoUnknownCluster({
          known: Object.values(configs).map((entry) => entry.uid),
          uid,
        }),
      );
    }
    // ⛔ Two entries claiming one uid is a configuration error: refuse, never pick one.
    if (matches.length > 1) {
      return yield* Effect.fail(
        new TalosOpenBaoAmbiguousUid({ aliases: matches.map(([alias]) => alias), uid }),
      );
    }
    const [alias, config] = match;
    // ⛔ A retired pin means the cluster is gone: no vault read, so destroying its rows completes.
    if (config.retired === true) {
      return yield* Effect.fail(
        new ClusterNotFoundError({ message: `talos-openbao cluster '${alias}' is retired` }),
      );
    }
    // ⛔ One deadline over the vault read AND the uid GET (`withConnectDeadline`).
    return yield* withConnectDeadline(
      alias,
      Effect.gen(function* () {
        const transport = yield* openTransport(config);
        yield* assertClusterUid(alias, uid, transport);
        return transport;
      }),
      timeout,
    );
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
