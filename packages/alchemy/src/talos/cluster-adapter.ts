/**
 * `Kubernetes.ClusterAdapter` kind `talos-openbao`.
 *
 * Reads `mount/key` from OpenBao at connect time (`credentials.ts`'s `readKvValue`, which
 * shells to `bao` with BAO_ADDR/BAO_TOKEN) and returns a `ClusterTransport`.
 * ⛔ NOTHING IS WRITTEN TO DISK. ⛔ THE PERSISTED CONNECTION IS `{ kind, cluster }` ONLY.
 *   alchemy `Kubernetes/Connection.ts` (v2.0.0-beta.79, lines 12-14) stores the Connection on
 *   every workload's attributes, so the upstream `client-cert` kind would put the admin PEM in
 *   the shared state store. The stock `kubeconfig` kind is also refused: an empty path falls
 *   back to `$KUBECONFIG`.
 * ⛔ mount/key/context LIVE IN THE ADAPTER'S CONFIGURATION, NOT IN THE AUTH BLOCK. Upstream
 *   compares clusters by the auth block (`internal/workload.ts:91-96` `connectionIdentity`) and
 *   HelmChart/Manifest answer `replace` when it changes (`HelmChart.ts:248-258`,
 *   `Manifest.ts:194-209`); a replace creates first, then cleanup deletes the SAME-named objects.
 *   Renaming a vault key would silently delete Cilium, External Secrets and Gatekeeper.
 *
 * Walked against alchemy 2.0.0-beta.79 `ClusterAdapter.ts` / `BuiltinAdapters.ts` and the OpenBao
 * v2.6.2 absence string in `isVaultKeyAbsent`. Fake `bao` only — no live vault and no cluster.
 */
import {
  ClusterAdapter,
  type ClusterAdapterService,
  ClusterNotFoundError,
  type ClusterTransport,
} from 'alchemy/Kubernetes/ClusterAdapter';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { DEFAULT_KUBECONFIG_KEY, isVaultKeyAbsent, readKvValue } from './credentials.ts';
import { kubeconfigTransport } from './kubeconfig-doc.ts';
import type { KubeconfigProps } from './kubeconfig.ts';

declare module 'alchemy/Kubernetes/Connection' {
  interface AuthRegistry {
    /**
     * Admin kubeconfig in OpenBao KV, read when a workload connects. Contributed by
     * {@link TalosOpenBaoAdapter}, which holds the mount, key and context.
     */
    'talos-openbao': {
      /** Logical cluster name, e.g. `c1`. Identity only: changing it moves workloads. */
      cluster: string;
    };
  }
}

/** One cluster's vault location. Configuration of the layer; never persisted. */
export type TalosOpenBaoCluster = {
  /** OpenBao KV mount, e.g. `talos-c1`. */
  readonly mount: string;
  /** Path under the mount. `Talos.Kubeconfig` writes `kubeconfig` unless `kubeconfigKey` is set. */
  readonly key: string;
  /** Context name inside the kubeconfig. Not secret. */
  readonly context: string;
  /**
   * ⛔ ONLY `true` MAKES A MISSING KEY MEAN "THE CLUSTER IS GONE" (`ClusterNotFoundError`, which
   *   upstream read/delete treat as "everything in-cluster is already gone"). Without it a missing
   *   key is the loud `TalosVaultKeyMissing`: a typo in mount/key must not make `read` report every
   *   row gone and `destroy` a silent no-op.
   */
  readonly retired?: boolean;
};

/**
 * ⛔ KEYED BY CLUSTER NAME, the `cluster` in the persisted connection. One adapter serves every
 *   cluster in a stack; `connect` looks the cluster up and refuses an unknown one
 *   ({@link TalosOpenBaoUnknownCluster}) instead of reading some other cluster's kubeconfig.
 */
export type TalosOpenBaoConfig = Readonly<Record<string, TalosOpenBaoCluster>>;

/**
 * ★ ONE SOURCE OF TRUTH FOR mount/key/context: build the cluster entry from the SAME props the
 *   `Talos.Kubeconfig` resource writes with (`target.mount`, `kubeconfigKey`, `context`), so the
 *   writer and the reader cannot disagree.
 */
export const talosOpenBaoCluster = (
  props: Pick<KubeconfigProps, 'context' | 'kubeconfigKey' | 'target'>,
  options: { readonly retired?: boolean } = {},
): TalosOpenBaoCluster => ({
  context: props.context,
  key: props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY,
  mount: props.target.mount,
  ...(options.retired === true ? { retired: true } : {}),
});

/** The connection names a cluster this adapter was not configured for. */
export class TalosOpenBaoUnknownCluster extends Data.TaggedError('TalosOpenBaoUnknownCluster')<{
  readonly cluster: string;
  readonly known: readonly string[];
}> {
  override get message(): string {
    return (
      `talos-openbao adapter has no configuration for cluster '${this.cluster}' ` +
      `(configured: ${this.known.join(', ') || 'none'}). Refused rather than reading another ` +
      "cluster's kubeconfig."
    );
  }
}

/** `bao kv get` reported the key unwritten. The message names `mount/key` and no document bytes. */
export class TalosVaultKeyMissing extends Data.TaggedError('TalosVaultKeyMissing')<{
  readonly mount: string;
  readonly key: string;
}> {
  override get message(): string {
    return (
      `${this.mount}/${this.key}: OpenBao has no value at this key. Talos.Kubeconfig writes it ` +
      'once at bring-up. Connect refused instead of reading a kubeconfig from disk.'
    );
  }
}

/** Vault bytes exist but are not a kubeconfig for the pinned context. The document is not echoed. */
export class TalosKubeconfigUnreadable extends Data.TaggedError('TalosKubeconfigUnreadable')<{
  readonly mount: string;
  readonly key: string;
  readonly context: string;
}> {
  override get message(): string {
    return (
      `${this.mount}/${this.key}: OpenBao kubeconfig does not parse for context ${this.context}. ` +
      'The document stayed in the vault. Connect wrote nothing to disk and nothing to state.'
    );
  }
}

/** The layer was asked to connect a different auth kind. */
export class TalosOpenBaoAuthKind extends Data.TaggedError('TalosOpenBaoAuthKind')<{
  readonly kind: string;
}> {
  override get message(): string {
    return (
      `talos-openbao adapter received auth kind '${this.kind}'. This adapter only connects ` +
      '`talos-openbao`.'
    );
  }
}

/** A `Connection` narrowed to this kind, so a PEM-bearing connection cannot be stored by type. */
export type TalosOpenBaoConnection = Connection & {
  readonly auth: { readonly kind: 'talos-openbao'; readonly cluster: string };
};

/** Serializable connection: kind and cluster name. No vault path, endpoint, CA or client cert. */
export const talosOpenBaoConnection = (cluster: string): TalosOpenBaoConnection => ({
  auth: { kind: 'talos-openbao', cluster },
});

/**
 * Resolve one `talos-openbao` connection to a transport. Requires `ChildProcessSpawner`
 * because the vault read shells to `bao`.
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
  | TalosVaultKeyMissing
  | ClusterNotFoundError
  | TalosKubeconfigUnreadable
  | Error,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    if (connection.auth.kind !== 'talos-openbao') {
      return yield* Effect.fail(new TalosOpenBaoAuthKind({ kind: connection.auth.kind }));
    }
    const { cluster } = connection.auth;
    const config = Object.hasOwn(configs, cluster) ? configs[cluster] : undefined;
    if (config === undefined) {
      return yield* Effect.fail(
        new TalosOpenBaoUnknownCluster({ cluster, known: Object.keys(configs) }),
      );
    }
    const { context, key, mount } = config;
    const raw = yield* readKvValue(mount, key, ['kubeconfig', 'config']).pipe(
      Effect.mapError((error) => {
        if (!isVaultKeyAbsent(error)) return error;
        const missing = new TalosVaultKeyMissing({ key, mount });
        return config.retired === true
          ? new ClusterNotFoundError({ message: missing.message })
          : missing;
      }),
    );
    const material = yield* Effect.sync(() => kubeconfigTransport(raw, context));
    if (material === undefined) {
      return yield* Effect.fail(new TalosKubeconfigUnreadable({ context, key, mount }));
    }
    return { ...material, headers: Effect.succeed({}) } satisfies ClusterTransport;
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
