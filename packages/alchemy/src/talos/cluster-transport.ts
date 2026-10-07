/**
 * One cluster's vault location and the in-memory read of its admin kubeconfig, shared by the
 * `talos-openbao` adapter (which then verifies identity) and `Talos.ClusterIdentity` (which
 * reads the uid the adapter will later demand).
 */
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import {
  TalosKubeconfigUnreadable,
  TalosOpenBaoConnectTimeout,
  TalosVaultKeyMissing,
} from './cluster-adapter-errors.ts';
import { DEFAULT_KUBECONFIG_KEY, isVaultKeyAbsent, readKvValue } from './credentials.ts';
import { kubeconfigTransport } from './kubeconfig-doc.ts';
import type { KubeconfigProps } from './kubeconfig.ts';

/** Where one cluster's admin kubeconfig lives in the vault. Configuration; never persisted. */
export type TalosVaultLocation = {
  /** OpenBao KV mount, e.g. `talos-c1`. */
  readonly mount: string;
  /** Path under the mount. `Talos.Kubeconfig` writes `kubeconfig` unless `kubeconfigKey` is set. */
  readonly key: string;
  /** Context name inside the kubeconfig. Not secret. */
  readonly context: string;
};

/**
 * One adapter entry: a vault location PINNED to the physical cluster it must answer as.
 * ⛔ `uid` is the kube-system `metadata.uid`. The persisted auth block carries only this, and
 *   connect looks the entry up BY it, so renaming the alias, vault key, mount or context changes
 *   nothing upstream hashes (`internal/workload.ts:91-96` `connectionIdentity`). Connect still
 *   proves the answering cluster has this uid before it returns a transport.
 */
export type TalosOpenBaoCluster = TalosVaultLocation & {
  readonly uid: string;
  /**
   * ⛔ ONLY `true` MAKES THIS UID MEAN "THE CLUSTER IS GONE": connect answers `ClusterNotFoundError`
   *   (upstream read/delete treat it as "everything in-cluster is already gone") WITHOUT a vault
   *   read, so destroying a dead cluster's rows completes. Otherwise an absent key is the loud
   *   `TalosVaultKeyMissing`: a typo in mount/key must not make `destroy` a silent no-op.
   */
  readonly retired?: boolean;
};

/**
 * ★ ONE SOURCE OF TRUTH FOR mount/key/context: build the location from the SAME props the
 *   `Talos.Kubeconfig` resource writes with (`target.mount`, `kubeconfigKey`, `context`), so the
 *   writer and the reader cannot disagree.
 */
export const talosVaultLocation = (
  props: Pick<KubeconfigProps, 'context' | 'kubeconfigKey' | 'target'>,
): TalosVaultLocation => ({
  context: props.context,
  key: props.kubeconfigKey ?? DEFAULT_KUBECONFIG_KEY,
  mount: props.target.mount,
});

/** An adapter entry: {@link talosVaultLocation} plus the uid it is pinned to. */
export const talosOpenBaoCluster = (
  props: Pick<KubeconfigProps, 'context' | 'kubeconfigKey' | 'target'>,
  pin: { readonly uid: string; readonly retired?: boolean },
): TalosOpenBaoCluster => ({
  ...talosVaultLocation(props),
  uid: pin.uid,
  ...(pin.retired === true ? { retired: true } : {}),
});

/**
 * ⛔ ONE DEADLINE FOR THE WHOLE CONNECT PATH. `bao kv get` has no timeout of its own, and the
 *   uid GET's bound (`cluster-identity.ts`) only starts after the vault read returns, so a hung
 *   `bao` hung connect and every plan. Interrupting the effect closes the spawn scope, which
 *   signals the child's process group (`NodeChildProcessSpawner` `terminateProcessGroup`).
 */
export const CONNECT_TIMEOUT = Duration.seconds(10);

export const withConnectDeadline = <A, E, R>(
  cluster: string,
  effect: Effect.Effect<A, E, R>,
  timeout: Duration.Duration = CONNECT_TIMEOUT,
) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new TalosOpenBaoConnectTimeout({ cluster, seconds: Duration.toSeconds(timeout) }),
        ),
    }),
  );

/**
 * Vault read and parse, in memory. ⛔ No identity check here: callers decide what to trust.
 * ⚠️ Only a document that does not parse is `TalosKubeconfigUnreadable`; a parser or runtime
 *   failure (a missing global, a broken import) is a defect and propagates as one.
 */
export const openTransport = (config: TalosVaultLocation) =>
  Effect.gen(function* () {
    const { context, key, mount } = config;
    const raw = yield* readKvValue(mount, key, ['kubeconfig', 'config']).pipe(
      Effect.mapError((error) =>
        isVaultKeyAbsent(error) ? new TalosVaultKeyMissing({ key, mount }) : error,
      ),
    );
    const material = yield* Effect.sync(() => kubeconfigTransport(raw, context));
    if (material === undefined) {
      return yield* Effect.fail(new TalosKubeconfigUnreadable({ context, key, mount }));
    }
    return { ...material, headers: Effect.succeed({}) } satisfies ClusterTransport;
  });
