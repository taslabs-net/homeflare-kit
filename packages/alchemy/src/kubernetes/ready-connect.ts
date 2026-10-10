/**
 * Connect for `HomeFlare.Kubernetes.Ready`. `connectCluster` reads the vault and then makes the
 * cluster-identity GET (`talos/cluster-identity.ts`), so it reaches the apiserver too.
 *
 * ⛔ A SINGLE PASS (`read`/`diff`) connects once; only errors are scrubbed. Upstream's
 *   `KubernetesApiError` message quotes up to 1000 bytes of the response body (`client.ts:38-42`),
 *   and a 401/403/5xx on the identity GET carries it (round 1, finding 4).
 * ★ A POLL retries the connect on the poll's transients (identity timeout, 5xx, 429, upstream's
 *   transport error) every `pollInterval` until the poll's own deadline: on a first install the
 *   apiserver is exactly what a CNI rollout is restarting (round 1, finding 2). Vault failures,
 *   401/403, a uid mismatch and any untagged defect still propagate at once.
 */
import { connectCluster } from 'alchemy/Kubernetes/internal/client';
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import { scrubbed, transientOf } from './ready-classify.ts';
import type { LastTransient } from './ready-errors.ts';

type Connection = Parameters<typeof connectCluster>[0];

/** Connect once. */
export const connectOnce = (connection: Connection) =>
  connectCluster(connection).pipe(Effect.mapError(scrubbed));

/**
 * Connect once for `diff`: a transient is `undefined` (the plan says `update`, `reconcile` waits);
 * everything else fails scrubbed. ⚠️ Classified BEFORE scrubbing: the scrubbed 5xx loses its tag.
 */
export const connectForDiff = (connection: Connection) =>
  Effect.gen(function* () {
    const attempt = yield* Effect.result(connectCluster(connection));
    if (attempt._tag === 'Success') return attempt.success as ClusterTransport;
    return transientOf(attempt.failure) === undefined
      ? yield* Effect.fail(scrubbed(attempt.failure))
      : undefined;
  });

/** Connect, retrying transients until the caller's deadline interrupts. */
export const connectTolerant =
  (connection: Connection, pollInterval: Duration.Duration) =>
  (note: (transient: LastTransient) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      while (true) {
        const attempt = yield* Effect.result(connectCluster(connection));
        if (attempt._tag === 'Success') return attempt.success as ClusterTransport;
        const transient = transientOf(attempt.failure);
        if (transient === undefined) return yield* Effect.fail(scrubbed(attempt.failure));
        yield* note(transient);
        yield* Effect.sleep(pollInterval);
      }
    });
