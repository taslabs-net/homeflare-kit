/**
 * One Valkey command as a span, with a deadline, failing as `RedisError`.
 *
 * ⛔ A SPAN NAMES THE COMMAND, NEVER ITS ARGUMENTS. Keys are seat data and values are whatever the
 *   seat stored; `AUTH` and `HELLO ... AUTH` carry a password. Only the upper-cased command name
 *   (`SET`, `GET`) is recorded, so the span is low-cardinality and holds nothing to redact.
 * 🔴 THE DEADLINE IS NOT OPTIONAL. Measured 2026-09-29 (Bun 1.4.0): a `Bun.RedisClient` on its
 *   defaults that has lost its server QUEUES every command and never answers it until the server
 *   is back (a `send` sat unresolved past 8 s against a dead port; after a restart the queued
 *   command completed ~5 s later). With the offline queue off (`state-valkey.ts` sets it) a dropped
 *   connection fails at once, but a peer that holds the socket open and says nothing would still
 *   wedge a seat forever, so every command carries `commandTimeout` too.
 */
import * as Effect from 'effect/Effect';
import * as Redis from 'effect/unstable/persistence/Redis';
import type * as Duration from 'effect/Duration';

/** What this file needs of a client: `Bun.RedisClient` has this exact `send`. */
export type ValkeyCall = {
  readonly send: (command: string, args: Array<string>) => Promise<unknown>;
};

/** `send` as `Redis.make` wants it. */
export type Send = <A = unknown>(
  command: string,
  ...args: ReadonlyArray<string>
) => Effect.Effect<A, Redis.RedisError>;

export type SendOptions = {
  /** How long one command may take before it fails as `RedisError`. */
  readonly commandTimeout: Duration.Input;
  /** The command deadline in milliseconds, for the message only. */
  readonly commandTimeoutMs: number;
  /** Span attributes every command carries: `db.system.name`, the server address, no secrets. */
  readonly attributes: Readonly<Record<string, unknown>>;
};

export function instrumentedSend(client: ValkeyCall, options: SendOptions): Send {
  return <A = unknown>(command: string, ...args: ReadonlyArray<string>) => {
    const name = command.toUpperCase();
    return Effect.tryPromise({
      // ⚠️ Bun's `send` types its argument list as a mutable array; ours is readonly.
      try: () => client.send(command, [...args]) as Promise<A>,
      catch: (cause) => new Redis.RedisError({ cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: options.commandTimeout,
        orElse: () =>
          Effect.fail(
            new Redis.RedisError({
              cause: new Error(
                `valkey ${name} did not answer within ${String(options.commandTimeoutMs)} ms`,
              ),
            }),
          ),
      }),
      Effect.withSpan(`valkey ${name}`, {
        kind: 'client',
        attributes: { ...options.attributes, 'db.operation.name': name },
      }),
    );
  };
}
