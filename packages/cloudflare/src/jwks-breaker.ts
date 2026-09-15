/**
 * A circuit breaker for JWKS fetches, installed at jose's own `customFetch` seam.
 *
 * ⛔ THE AMPLIFICATION THIS CLOSES, MEASURED ON jose 6.2.12 — the version this package
 *   pins, not an old one:
 *
 *       5 verifications of a well-formed token, certs endpoint 404ing → 5 outbound fetches
 *
 *   jose assigns `jwksTimestamp` only inside the `.then()` of a SUCCESSFUL fetch
 *   (`dist/webapi/jwks/remote.js`, line 58). While an endpoint is down, `local` stays
 *   undefined, so `if (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) await reload()`
 *   runs on EVERY call. A down Access endpoint therefore turns every inbound request into
 *   an outbound fetch, indefinitely.
 *
 * ★ NOT A REIMPLEMENTATION. `customFetch` is jose's exported, documented extension point;
 *   jose keeps doing the caching, cooldown, `kid` matching and verification. This adds the
 *   one thing it does not do — remember that a fetch FAILED.
 *   ⚠️ Measured first: neither `cacheMaxAge: Infinity` nor `cooldownDuration` nor both
 *     together change the count. It is 5 fetches in every configuration, so this is not a
 *     matter of configuring jose correctly.
 *
 * ⛔ THE BREAKER STORES PLAIN VALUES ONLY — a timestamp and an Error. NEVER a Response, a
 *   body stream, or a promise of one.
 *   🔴 On workerd, a Response and its body belong to the IoContext of the request that
 *     created them, and another request touching either throws:
 *         Cannot perform I/O on behalf of a different request.
 *     Caching a Response across requests would therefore turn a VALID token into a flat
 *     401 for every caller but the first — an outage strictly worse than the amplification
 *     it was meant to fix. Timestamps and Errors cross requests legally; I/O objects do not.
 */

import type { FetchImplementation } from 'jose';

/** How long a URL stays latched open after a failed probe. */
export const BREAKER_COOLDOWN_MS = 30_000;

type Failure = { readonly at: number; readonly error: Error };

/**
 * ⚠️ Module scope is PER ISOLATE on workerd, which is the right lifetime: long enough to
 *   stop the storm, short enough that a recycled isolate retries a recovered endpoint.
 */
const failures = new Map<string, Failure>();

/** Visible for testing. ⛔ Not exported from the package — resetting it in production
 *  would discard exactly the memory this exists to keep. */
export function resetBreaker(): void {
  failures.clear();
}

/**
 * Wrap a fetch so a failing URL is not retried for `cooldownMs`.
 *
 * ★ FAILURE IS COUNTED AT THE SEAM, not inferred from an error class further up. jose
 *   throws `JWKSNoMatchingKey` as a NORMAL answer from a perfectly healthy endpoint — a
 *   token signed with a rotated key does that — so treating it as a fault would latch a
 *   working endpoint closed and reject every valid token for 30 seconds.
 */
export function breakered(
  inner: FetchImplementation = (url, options) => fetch(url, options),
  cooldownMs: number = BREAKER_COOLDOWN_MS,
): FetchImplementation {
  // ⚠️ jose's OWN FetchImplementation, not `typeof fetch`. It is narrower — a string URL
  //   and a fixed options shape — and using the global type instead fails to typecheck on
  //   `preconnect`, a property of the platform fetch that no seam implementation has.
  return async (url, options) => {
    const open = failures.get(url);

    if (open !== undefined && Date.now() - open.at < cooldownMs) {
      // ⚠️ Rethrow the ORIGINAL error, not a generic one: the first failure says whether
      //   this was a 404, a TLS problem or a timeout, and that is what an operator needs.
      //   A "circuit open" message alone hides the actual fault.
      throw open.error;
    }

    try {
      const response = await inner(url, options);

      // ⛔ A non-200 is a failure here. jose requires 200 with a JSON body; a 404 or a 502
      //   is exactly the down-endpoint case, and it does NOT throw on its own.
      if (!response.ok) {
        const error = new Error(`JWKS endpoint answered ${String(response.status)}: ${url}`);
        failures.set(url, { at: Date.now(), error });
        throw error;
      }

      failures.delete(url);
      return response;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      // `set` is idempotent here — a second failure simply restarts the cooldown.
      failures.set(url, { at: Date.now(), error });
      throw error;
    }
  };
}
