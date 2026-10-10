/**
 * The poll loop of `HomeFlare.Kubernetes.Ready`: one bounded GET per check, and the deadline.
 * Reads go through alchemy's own `readObject` (TLS, CA and client-cert handling stay upstream's),
 * over the transport `connectCluster` proved against the pinned uid.
 *
 * ⛔ Error classes live in `ready-classify.ts` (404 pending; transients tolerated ONLY in a poll;
 *   everything else propagates). A single pass (`tolerant: false`, used by `read`/`diff`)
 *   tolerates ONLY 404. The poll covers the CONNECT too (`ready-connect.ts`): the identity GET of
 *   a cluster whose apiserver is restarting under a CNI rollout is the same transient.
 * ⚠️ upstream `readObject` takes no signal: a timed-out GET abandons its socket rather than
 *   aborting it (`client.ts:71-74`). The pass moves on; the process exit reaps it.
 */
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import { readObject } from 'alchemy/Kubernetes/internal/client';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';
import { isNotFound, scrubbed, transientOf } from './ready-classify.ts';
import { type ReadyCheck, checkKey, countsOf, evaluate } from './ready-checks.ts';
import {
  type KeyState,
  KubernetesReadyTimeout,
  KubernetesRolloutFailed,
  type LastTransient,
} from './ready-errors.ts';

export { KubernetesReadyApiError, isNotFound, transientOf } from './ready-classify.ts';

/** Each GET is bounded like `readClusterUid` (`talos/cluster-identity.ts`). */
export const GET_TIMEOUT = Duration.seconds(5);

/** One GET exceeded `GET_TIMEOUT`. Pending inside a poll, propagated by a single pass. */
export class KubernetesReadyGetTimeout extends Data.TaggedError('KubernetesReadyGetTimeout')<{
  readonly check: string;
  readonly seconds: number;
}> {
  override get message(): string {
    return `Kubernetes.Ready: GET for ${this.check} timed out after ${this.seconds}s`;
  }
}

const REFS = {
  CustomResourceDefinition: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
  },
  DaemonSet: { apiVersion: 'apps/v1', kind: 'DaemonSet' },
  Deployment: { apiVersion: 'apps/v1', kind: 'Deployment' },
} as const;

const refOf = (check: ReadyCheck) => ({
  ...REFS[check.kind],
  name: check.name,
  ...('namespace' in check ? { namespace: check.namespace } : {}),
});

export interface PassResult {
  /** Keys of checks that are not ready yet. */
  readonly pending: readonly string[];
  /** Keys of checks that are terminally failed (see `KubernetesRolloutFailed`). */
  readonly failed: readonly string[];
  /** What this pass saw per key it reached; a key that hit a transient has none. */
  readonly states: Readonly<Record<string, KeyState>>;
  readonly lastTransient?: LastTransient;
}

const getOne = (transport: ClusterTransport, check: ReadyCheck) =>
  readObject({ object: refOf(check), transport }).pipe(
    Effect.timeoutOrElse({
      duration: GET_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new KubernetesReadyGetTimeout({
            check: checkKey(check),
            seconds: Duration.toSeconds(GET_TIMEOUT),
          }),
        ),
    }),
  );

/** One look at every check. `tolerant` selects the poll rules; see the header. */
export const pass = (
  transport: ClusterTransport,
  checks: readonly ReadyCheck[],
  tolerant: boolean,
): Effect.Effect<PassResult, unknown> =>
  Effect.gen(function* () {
    const pending: string[] = [];
    const failed: string[] = [];
    const states: Record<string, KeyState> = {};
    let lastTransient: LastTransient | undefined;
    for (const check of checks) {
      const key = checkKey(check);
      const outcome = yield* getOne(transport, check).pipe(
        Effect.map((body) => {
          states[key] = countsOf(check, body);
          return evaluate(check, body);
        }),
        Effect.catch((error: unknown) => {
          if (isNotFound(error)) {
            states[key] = { notFound: true };
            return Effect.succeed('pending' as const);
          }
          const transient = tolerant ? transientOf(error) : undefined;
          if (transient === undefined) return Effect.fail(scrubbed(error));
          lastTransient = transient;
          return Effect.succeed('pending' as const);
        }),
      );
      if (outcome === 'pending') pending.push(key);
      if (outcome === 'failed') failed.push(key);
    }
    return { failed, pending, states, ...(lastTransient === undefined ? {} : { lastTransient }) };
  });

/**
 * Poll until every check is ready. A terminal failure ends it at once; otherwise the deadline
 * fails with the check keys that were pending on the LAST pass, what that pass saw of each, and
 * the transient error of the last pass only (⚠️ a transient that cleared is not to be blamed).
 * `connect` runs inside the deadline (it retries its own transients, `ready-connect.ts`).
 */
export const poll = <R>(
  connect: (
    note: (transient: LastTransient) => Effect.Effect<void>,
  ) => Effect.Effect<ClusterTransport, unknown, R>,
  checks: readonly ReadyCheck[],
  waitTimeout: Duration.Duration,
  pollInterval: Duration.Duration,
) =>
  Effect.gen(function* () {
    const pendingNow = checks.map(checkKey);
    const last = yield* Ref.make<{ pending: readonly string[]; states: Record<string, KeyState> }>({
      pending: pendingNow,
      states: {},
    });
    const transient = yield* Ref.make<LastTransient | undefined>(undefined);
    const loop = Effect.gen(function* () {
      const transport = yield* connect((t) => Ref.set(transient, t));
      while (true) {
        const result = yield* pass(transport, checks, true);
        yield* Ref.update(last, (prior) => ({
          pending: result.pending,
          states: { ...prior.states, ...result.states },
        }));
        // ★ Overwritten every pass, so a transient that has since cleared is not blamed.
        yield* Ref.set(transient, result.lastTransient);
        const [firstFailed] = result.failed;
        if (firstFailed !== undefined) {
          return yield* Effect.fail(
            new KubernetesRolloutFailed({
              check: firstFailed,
              reason: firstFailed.startsWith('DaemonSet/')
                ? 'UpdateStrategyNotRollingUpdate'
                : 'ProgressDeadlineExceeded',
            }),
          );
        }
        if (result.pending.length === 0) return;
        yield* Effect.sleep(pollInterval);
      }
    });
    return yield* loop.pipe(
      Effect.timeoutOrElse({
        duration: waitTimeout,
        orElse: () =>
          Effect.gen(function* () {
            const { pending, states } = yield* Ref.get(last);
            const lastTransient = yield* Ref.get(transient);
            const seen = Object.fromEntries(
              pending.flatMap((k) => (states[k] ? [[k, states[k]]] : [])),
            );
            return yield* Effect.fail(
              new KubernetesReadyTimeout({
                failing: pending,
                seconds: Duration.toSeconds(waitTimeout),
                states: seen,
                ...(lastTransient === undefined ? {} : { lastTransient }),
              }),
            );
          }),
      }),
    );
  });
