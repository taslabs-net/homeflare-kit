/**
 * Error classification for `HomeFlare.Kubernetes.Ready`, shared by the poll (`ready-poll.ts`) and
 * the connect (`ready-connect.ts`).
 *
 * ⛔ ERROR CLASSES (T10 design v3 §2, round-2 findings 3b and 8, round-1 finding 3):
 *   - 404 is PENDING everywhere. Version-proof: `_tag === 'KubernetesNotFound'` OR a
 *     `KubernetesApiError` with `statusCode === 404` (beta.81 raises the latter,
 *     `Kubernetes/internal/client.ts:32-37`; a later alchemy may raise the former). Matched by
 *     tag string, no import, so neither shape needs a kit release.
 *   - TRANSIENT, tolerated only inside a poll or its connect: a per-GET timeout, the identity
 *     timeout, `KubernetesApiError` 5xx/429, and upstream's transport error, which is the plain
 *     `Error` whose message starts `Failed Kubernetes ` (`client.ts:146-148`).
 *   - ⚠️ ANY OTHER UNTAGGED `Error` IS A DEFECT AND PROPAGATES. It used to count as transport, which
 *     made upstream's path-builder throw for an empty namespace (`objects.ts:189-192`) and a
 *     failing `bao` (`credentials.ts` plain `Error`s) look like a slow rollout for ten minutes.
 *   - Everything else propagates: 401/403/other 4xx, vault failures (the ClusterHealth rule).
 */
import * as Data from 'effect/Data';
import type { LastTransient } from './ready-errors.ts';

interface Tagged {
  readonly _tag?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
}

export const isNotFound = (error: unknown): boolean => {
  const e = error as Tagged | null;
  return (
    e?._tag === 'KubernetesNotFound' || (e?._tag === 'KubernetesApiError' && e.statusCode === 404)
  );
};

/** Upstream's transport failure wrapper (`client.ts:146-148`); its message names no body. */
const UPSTREAM_TRANSPORT = /^Failed Kubernetes /;

/** The tolerable-in-a-poll classes, as a record of tag + status; `undefined` means propagate. */
export const transientOf = (error: unknown): LastTransient | undefined => {
  const e = error as Tagged | null;
  if (e?._tag === 'KubernetesReadyGetTimeout') return { tag: 'KubernetesReadyGetTimeout' };
  if (e?._tag === 'TalosClusterIdentityTimeout') return { tag: 'TalosClusterIdentityTimeout' };
  if (e?._tag === 'KubernetesApiError') {
    const status = typeof e.statusCode === 'number' ? e.statusCode : 0;
    return status >= 500 || status === 429 ? { status, tag: 'KubernetesApiError' } : undefined;
  }
  return error instanceof Error && e?._tag === undefined && UPSTREAM_TRANSPORT.test(error.message)
    ? { tag: 'TransportError' }
    : undefined;
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

/** ⛔ Wrap every error that leaves a GET, the identity GET of connect included (round 1, finding 4). */
export const scrubbed = (error: unknown): unknown => {
  const e = error as { _tag?: unknown; method?: unknown; path?: unknown; statusCode?: unknown };
  return e?._tag === 'KubernetesApiError'
    ? new KubernetesReadyApiError({
        method: String(e.method),
        path: String(e.path),
        statusCode: Number(e.statusCode),
      })
    : error;
};
