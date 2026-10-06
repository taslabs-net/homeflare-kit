/**
 * One cluster's vault location and the in-memory read of its admin kubeconfig, shared by the
 * `talos-openbao` adapter (which then verifies identity) and `Talos.ClusterIdentity` (which
 * reads the uid the adapter will later demand).
 */
import { ClusterNotFoundError, type ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import * as Effect from 'effect/Effect';
import { TalosKubeconfigUnreadable, TalosVaultKeyMissing } from './cluster-adapter-errors.ts';
import { DEFAULT_KUBECONFIG_KEY, isVaultKeyAbsent, readKvValue } from './credentials.ts';
import { kubeconfigTransport } from './kubeconfig-doc.ts';
import type { KubeconfigProps } from './kubeconfig.ts';

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

/**
 * Vault read and parse, in memory. ⛔ No identity check here: callers decide what to trust.
 * ⚠️ Only a document that does not parse is `TalosKubeconfigUnreadable`; a parser or runtime
 *   failure (a missing global, a broken import) is a defect and propagates as one.
 */
export const openTransport = (config: TalosOpenBaoCluster) =>
  Effect.gen(function* () {
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
