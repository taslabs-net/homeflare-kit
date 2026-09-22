/**
 * Errors a CALLER can act on — an agent, a retry loop, or a person reading a log.
 *
 * ★ PORTED FROM AN INTERNAL MCP TOOLKIT, where 34 packages proved
 *   the shape. Generalised: that version is MCP-specific (`HouseToolError`), this
 *   one is not, so a Worker or a script can use the same vocabulary.
 *
 * ⛔ THE RULE THIS ENFORCES: a failure must never be silent, and never ambiguous with a
 *   DIFFERENT failure. Both halves were learned from incidents, not from principle:
 *   - An Access provider read its token at module scope and, when that failed, silently
 *     omitted the auth header. Cloudflare answered a bare 401 — indistinguishable from a
 *     bad credential — and sent an operator to debug the wrong subsystem. Omitting is
 *     worse than throwing.
 *   - A gate reported success on a corrupted file because it compared the file to itself.
 *     A check that cannot fail is worse than no check, because it is trusted.
 *
 * ⚠️ THE AUDIENCE MAY BE AN AGENT, not a human with a debugger. An agent cannot open a
 *   dashboard or ask a colleague, so everything it needs to pick its next action must be
 *   in the error. One that reads "permission denied" retries forever; one that reads
 *   "the token lacks Grafana Read; ask an operator to widen the grant" stops and reports.
 */

/** Which class of failure this is. Callers branch on it, so the set stays small. */
export type ErrorKind =
  /** Not who it claims, or claims nothing. Retrying unchanged fails. */
  | 'unauthenticated'
  /** Known, but lacks the grant. ⛔ NEVER retry — a human must widen a scope. */
  | 'forbidden'
  /** The upstream said no. The caller may be able to fix its arguments and retry. */
  | 'upstream_rejected'
  /**
   * Over a rate limit. The IDENTICAL call succeeds after the stated delay.
   * 🔴 A DISTINCT KIND BECAUSE IT WAS LANDING AS `bad_arguments`, measured 2026-09-07 in
   *   production: a 429 mapped to "your arguments are wrong", so a throttled agent
   *   rewrote a correct call, was throttled again, and concluded the tool was broken.
   *   This is the refusal agents meet most — Cloudflare frontier models are 20 rpm.
   */
  | 'rate_limited'
  /** Could not be reached at all. Usually transient; a retry may work. */
  | 'upstream_unreachable'
  /** Called with arguments it cannot accept. Correct them and retry. */
  | 'bad_arguments'
  /** We are misconfigured. ⛔ A caller cannot fix this; it must report it. */
  | 'misconfigured';

/**
 * What each kind means, for anything that has to explain them.
 *
 * ⛔ TYPED AS Record<ErrorKind, string>, WHICH IS THE POINT: adding a kind above without
 *   describing it here is a COMPILE ERROR. A hand-kept list beside a union goes stale,
 *   and a documented error contract with a missing case is worse than none — it is
 *   trusted.
 */
export const KIND_DESCRIPTIONS: Record<ErrorKind, string> = {
  unauthenticated: 'The credential was missing, malformed, or rejected.',
  forbidden: 'The credential is valid but lacks the required grant. Do not retry.',
  upstream_rejected: 'The upstream refused the request as made.',
  rate_limited: 'Throttled. The identical call succeeds after the stated delay.',
  upstream_unreachable: 'The upstream could not be reached. A retry may succeed.',
  bad_arguments: 'The arguments were not acceptable. Correct them and retry.',
  misconfigured: 'This service is misconfigured and cannot serve the request.',
};

export interface KitErrorOptions {
  /** Which system failed. ⛔ Name it — "request failed" tells a caller nothing. */
  readonly system: string;
  /** What would make it work. This is what stops an agent retrying forever. */
  readonly remedy?: string;
  /** For `rate_limited`: how long to wait, in milliseconds. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

/** A failure with enough shape for a caller to decide what to do next. */
export class KitError extends Error {
  readonly kind: ErrorKind;
  readonly system: string;
  readonly remedy: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ErrorKind, message: string, options: KitErrorOptions) {
    super(`${options.system}: ${message}`, { cause: options.cause });
    this.name = 'KitError';
    this.kind = kind;
    this.system = options.system;
    this.remedy = options.remedy;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** True when retrying the identical call could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'upstream_unreachable';
  }
}

/**
 * Map an HTTP status to a kind.
 *
 * ⚠️ 429 IS CHECKED EXPLICITLY, not left to fall through. It used to reach
 *   `upstream_rejected` here and `bad_arguments` elsewhere — both of which tell a caller
 *   to CHANGE ITS ARGUMENTS, which is precisely wrong for a throttle.
 */
export function kindForStatus(status: number): ErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unreachable';
  return 'upstream_rejected';
}
