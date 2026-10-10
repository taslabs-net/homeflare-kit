/**
 * The poll loop of `HomeFlare.Kubernetes.Ready`: one bounded GET per check, error classification,
 * and the deadline. Reads go through alchemy's own `readObject` (TLS, CA and client-cert handling
 * stay upstream's), over the transport `connectCluster` proved against the pinned uid.
 *
 * ⛔ ERROR CLASSES (T10 design v3 §2, round-2 findings 3b and 8):
 *   - 404 is PENDING everywhere. Version-proof: `_tag === 'KubernetesNotFound'` OR a
 *     `KubernetesApiError` with `statusCode === 404` (beta.81 raises the latter,
 *     `Kubernetes/internal/client.ts:32-37`; a later alchemy may raise the former). Matched by
 *     tag string, no import, so neither shape needs a kit release. A Deployment or CRD a chart has
 *     not yet created is "not yet", not an error.
 *   - In a POLL (`tolerant`): a per-GET timeout, `KubernetesApiError` 5xx/429 and a transport
 *     `Error` (no `_tag`, `client.ts:145-150`) are PENDING and recorded as `lastTransient` (tag +
 *     status, never a body): an apiserver restarting under a CNI rollout is the expected case.
 *   - Everything else propagates: 401/403/other 4xx (the credential is wrong, waiting cannot fix
 *     it), connect/vault failures (the ClusterHealth rule, `talos-cluster-health.ts` header).
 *   - A single pass (`tolerant: false`, used by `read`/`diff`) tolerates ONLY 404.
 * ⚠️ upstream `readObject` takes no signal: a timed-out GET abandons its socket rather than
 *   aborting it (`client.ts:71-74`). The pass moves on; the process exit reaps it.
 */
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import { readObject } from 'alchemy/Kubernetes/internal/client';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';
import * as Data from 'effect/Data';
import {
  KubernetesReadyTimeout,
  KubernetesRolloutFailed,
  type LastTransient,
  type ReadyCheck,
  checkKey,
  evaluate,
} from './ready-checks.ts';

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

interface Tagged {
  readonly _tag?: unknown;
  readonly statusCode?: unknown;
}

export const isNotFound = (error: unknown): boolean => {
  const e = error as Tagged | null;
  return (
    e?._tag === 'KubernetesNotFound' || (e?._tag === 'KubernetesApiError' && e.statusCode === 404)
  );
};

/** The tolerable-in-a-poll classes, as a record of tag + status; `undefined` means propagate. */
export const transientOf = (error: unknown): LastTransient | undefined => {
  const e = error as Tagged | null;
  if (e?._tag === 'KubernetesReadyGetTimeout') return { tag: 'KubernetesReadyGetTimeout' };
  if (e?._tag === 'KubernetesApiError') {
    const status = typeof e.statusCode === 'number' ? e.statusCode : 0;
    return status >= 500 || status === 429 ? { status, tag: 'KubernetesApiError' } : undefined;
  }
  // A transport failure is a plain Error with no `_tag`; any tagged error is someone else's.
  return error instanceof Error && e?._tag === undefined ? { tag: 'TransportError' } : undefined;
};

/**
 * A propagated apiserver refusal (401/403/other 4xx, or any status in a single pass). ⛔ Upstream's
 * `KubernetesApiError` message quotes up to 1000 bytes of the response body (`client.ts:38-42`);
 * a body is the server's text, not ours to republish into logs and run output, so it is dropped.
 */
export class KubernetesReadyApiError extends Data.TaggedError('KubernetesReadyApiError')<{
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
}> {
  override get message(): string {
    return `Kubernetes.Ready: ${this.method} ${this.path} responded ${this.statusCode}`;
  }
}

const scrubbed = (error: unknown): unknown => {
  const e = error as { _tag?: unknown; method?: unknown; path?: unknown; statusCode?: unknown };
  return e?._tag === 'KubernetesApiError'
    ? new KubernetesReadyApiError({
        method: String(e.method),
        path: String(e.path),
        statusCode: Number(e.statusCode),
      })
    : error;
};

export interface PassResult {
  /** Keys of checks that are not ready yet. */
  readonly pending: readonly string[];
  /** Keys of checks that are terminally failed (ProgressDeadlineExceeded). */
  readonly failed: readonly string[];
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
    let lastTransient: LastTransient | undefined;
    for (const check of checks) {
      const outcome = yield* getOne(transport, check).pipe(
        Effect.map((body) => evaluate(check, body)),
        Effect.catch((error: unknown) => {
          if (isNotFound(error)) return Effect.succeed('pending' as const);
          const transient = tolerant ? transientOf(error) : undefined;
          if (transient === undefined) return Effect.fail(scrubbed(error));
          lastTransient = transient;
          return Effect.succeed('pending' as const);
        }),
      );
      if (outcome === 'pending') pending.push(checkKey(check));
      if (outcome === 'failed') failed.push(checkKey(check));
    }
    return { failed, pending, ...(lastTransient === undefined ? {} : { lastTransient }) };
  });

/**
 * Poll until every check is ready. A terminal failure ends it at once; otherwise the deadline
 * fails with the check keys that were pending on the LAST pass and the last transient error.
 */
export const poll = (
  transport: ClusterTransport,
  checks: readonly ReadyCheck[],
  waitTimeout: Duration.Duration,
  pollInterval: Duration.Duration,
) =>
  Effect.gen(function* () {
    const last = yield* Ref.make<PassResult>({ failed: [], pending: checks.map(checkKey) });
    const transient = yield* Ref.make<LastTransient | undefined>(undefined);
    const loop = Effect.gen(function* () {
      while (true) {
        const result = yield* pass(transport, checks, true);
        yield* Ref.set(last, result);
        if (result.lastTransient !== undefined) yield* Ref.set(transient, result.lastTransient);
        const [firstFailed] = result.failed;
        if (firstFailed !== undefined) {
          return yield* Effect.fail(new KubernetesRolloutFailed({ check: firstFailed }));
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
            const { pending } = yield* Ref.get(last);
            const lastTransient = yield* Ref.get(transient);
            return yield* Effect.fail(
              new KubernetesReadyTimeout({
                failing: pending,
                seconds: Duration.toSeconds(waitTimeout),
                ...(lastTransient === undefined ? {} : { lastTransient }),
              }),
            );
          }),
      }),
    );
  });
