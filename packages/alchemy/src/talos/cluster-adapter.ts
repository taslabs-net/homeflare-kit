/**
 * `Kubernetes.ClusterAdapter` kind `talos-openbao`.
 *
 * Reads `mount/key` from OpenBao at connect time (`credentials.ts`'s `readKvValue`, which
 * shells to `bao` and therefore inherits the lane's BAO env) and returns a `ClusterTransport`.
 * ⛔ NOTHING IS WRITTEN TO DISK. ⛔ THE PERSISTED CONNECTION IS `{ kind, mount, key, context }`
 *   ONLY. alchemy `Kubernetes/Connection.ts` (v2.0.0-beta.79, lines 12-14) stores the Connection
 *   on every workload's attributes, so the upstream `client-cert` kind would put the admin PEM
 *   in the shared state store. The stock `kubeconfig` kind is also refused: an empty path falls
 *   back to `$KUBECONFIG`.
 *
 * Walked against alchemy 2.0.0-beta.79 `ClusterAdapter.ts` / `BuiltinAdapters.ts` and the OpenBao
 * v2.6.2 absence string in `isVaultKeyAbsent`. Fake `bao` only — no live vault and no cluster.
 */
import {
  ClusterAdapter,
  type ClusterAdapterService,
  type ClusterTransport,
} from 'alchemy/Kubernetes/ClusterAdapter';
import type { Connection } from 'alchemy/Kubernetes/Connection';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { isVaultKeyAbsent, readKvValue } from './credentials.ts';
import { kubeconfigTransport } from './kubeconfig-doc.ts';

declare module 'alchemy/Kubernetes/Connection' {
  interface AuthRegistry {
    /**
     * Admin kubeconfig in OpenBao KV, read when a workload connects.
     * Contributed by {@link TalosOpenBaoAdapter}.
     */
    'talos-openbao': {
      /** OpenBao KV mount, e.g. `talos-c1`. */
      mount: string;
      /** Path under the mount. `Talos.Kubeconfig` writes `kubeconfig`. */
      key: string;
      /** Context name inside the kubeconfig. Not secret. */
      context: string;
    };
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

/** Serializable connection. No endpoint, no CA, no client cert. */
export const talosOpenBaoConnection = (auth: {
  readonly mount: string;
  readonly key: string;
  readonly context: string;
}): Connection => ({
  auth: { kind: 'talos-openbao', mount: auth.mount, key: auth.key, context: auth.context },
});

/**
 * Resolve one `talos-openbao` connection to a transport. Requires `ChildProcessSpawner`
 * because the vault read shells to `bao`.
 */
export const connectTalosOpenBao = (
  connection: Connection,
): Effect.Effect<
  ClusterTransport,
  TalosOpenBaoAuthKind | TalosVaultKeyMissing | TalosKubeconfigUnreadable | Error,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    if (connection.auth.kind !== 'talos-openbao') {
      return yield* Effect.fail(new TalosOpenBaoAuthKind({ kind: connection.auth.kind }));
    }
    const auth = connection.auth;
    const raw = yield* readKvValue(auth.mount, auth.key, ['kubeconfig', 'config']).pipe(
      Effect.mapError((error) =>
        isVaultKeyAbsent(error)
          ? new TalosVaultKeyMissing({ key: auth.key, mount: auth.mount })
          : error,
      ),
    );
    const material = yield* Effect.sync(() => kubeconfigTransport(raw, auth.context));
    if (material === undefined) {
      return yield* Effect.fail(
        new TalosKubeconfigUnreadable({
          context: auth.context,
          key: auth.key,
          mount: auth.mount,
        }),
      );
    }
    return { ...material, headers: Effect.succeed({}) } satisfies ClusterTransport;
  });

/**
 * Register kind `talos-openbao`. Merge with `Kubernetes.providers()`:
 * `Layer.mergeAll(Kubernetes.providers(), TalosOpenBaoAdapter())`.
 */
export const TalosOpenBaoAdapter = (): Layer.Layer<
  ClusterAdapterService,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    ClusterAdapter('talos-openbao'),
    Effect.gen(function* () {
      const context = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
      const service: ClusterAdapterService = {
        kind: 'Kubernetes.ClusterAdapter',
        connect: (connection) =>
          connectTalosOpenBao(connection).pipe(Effect.provideContext(context)),
      };
      return service;
    }),
  );
