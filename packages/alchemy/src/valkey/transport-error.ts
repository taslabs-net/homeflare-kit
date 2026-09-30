/**
 * Transport failures and the reply shapes a `ValkeyExecutor` returns.
 *
 * Split from `transport.ts` so the RESP reader can fail these tags without importing
 * the executor. `transport.ts` re-exports them; callers keep importing from there.
 */
import * as Data from 'effect/Data';

export type ValkeyReply =
  | { readonly kind: 'bulk'; readonly value: string | null }
  | { readonly kind: 'array'; readonly values: ReadonlyArray<string | null> }
  | { readonly kind: 'error'; readonly message: string };

/** A reply that came back as an error line (`-ERR …`). `detail` is the server's own error text;
 * the `message` getter names it without recursing. */
export class ValkeyServerError extends Data.TaggedError('ValkeyServerError')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

/** A socket-level failure (connection refused, reset, closed mid-reply, a reply past the cap,
 * a deadline) — distinct from a protocol-level `ValkeyServerError` so callers can tell "server
 * said no" from "never reached it" or "the socket this family owns was not bounded". */
export class ValkeySocketError extends Data.TaggedError('ValkeySocketError')<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/** The two transport-level failures every `ValkeyExecutor` can surface, as one union so a
 * caller's declared error channel stays short. */
export type ValkeyTransportError = ValkeyServerError | ValkeySocketError;
