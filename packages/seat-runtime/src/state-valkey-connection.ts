/**
 * Keeping one `Bun.RedisClient` connected for as long as its layer lives.
 *
 * 🔴 BUN GIVES UP, AND A CLIENT THAT HAS GIVEN UP STAYS DEAD. Measured 2026-09-29 (Bun 1.4.0, a raw
 *   client with `enableOfflineQueue: false` and the default `maxRetries` of 20, the server killed
 *   for 60 s, then restarted): Bun retried on its own for 31 s (commands failed `Connection is
 *   closed and offline queue is disabled`), then GAVE UP: `onclose` ran once and every command
 *   after failed `Connection has failed`, still so 10 s after the server was back. Only calling
 *   `connect()` again revived it (it resolved at once and `PING` answered). The budget is a sum of
 *   backoffs, so it is not one number: the review that found this measured recovery after 30 s and
 *   none after 45 s. A seat whose Valkey restarts for a minute (a container restart, CT100 booting)
 *   would keep a dead client until the process restarted, and no retry in Effect could help, since
 *   every retry hit the same dead client.
 * ★ SO THE LAYER RECONNECTS ITSELF, off `onclose`: single-flight, each attempt bounded by
 *   `connectionTimeout` (which does not bound DNS; see state-valkey.ts), backing off 250 ms up to
 *   5 s between attempts, one `valkey reconnect` span per attempt and a warning and an info line
 *   around the outage. It stops when the layer's scope closes.
 * ⚠️ `onclose` IS A HINT AND `connected` IS THE FACT. Measured on the same client: `onclose` also
 *   runs for every `connect()` that fails (each rejected after ~155 ms with `Connection closed`)
 *   and for the client's own `close()`, so a reconnect that trusted it would start itself. The
 *   loop therefore runs only while `connected` is false, and a wake-up that arrives after a
 *   successful reconnect finds nothing to do.
 * ⚠️ COMMANDS STILL FAIL AT ONCE WHILE IT IS DOWN (the offline queue is off on purpose): the
 *   caller's retry is what spans an outage, and from now on the retry is answered once this loop
 *   has reconnected, within the pause plus one attempt of the server coming back.
 */
import type { RedisClient } from 'bun';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Queue from 'effect/Queue';
import type * as Scope from 'effect/Scope';

/** What this file needs of `Bun.RedisClient`. */
export type Reconnectable = Pick<RedisClient, 'connected' | 'connect' | 'onclose'>;

export type KeepOptions = {
  /** How long one reconnect attempt may take before it is abandoned and retried. */
  readonly connectionTimeout: Duration.Input;
  /** Span attributes every attempt carries: the server address, no secrets. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** The pause after the first failed attempt, doubled up to `longestPause`. Default 250 ms. */
  readonly firstPause?: Duration.Input | undefined;
  /** The longest pause between attempts. Default 5 s. */
  readonly longestPause?: Duration.Input | undefined;
};

const DEFAULT_FIRST_PAUSE_MS = 250;
const DEFAULT_LONGEST_PAUSE_MS = 5000;

/**
 * Reconnect `client` whenever Bun gives up on it, for the life of the enclosing scope. Call it
 * AFTER the first `connect()` succeeded, so a wrong URL or password still fails the layer's build
 * instead of being retried forever.
 */
export const keepConnected: (
  client: Reconnectable,
  options: KeepOptions,
) => Effect.Effect<void, never, Scope.Scope> = Effect.fnUntraced(function* (
  client: Reconnectable,
  options: KeepOptions,
) {
  const wake = yield* Queue.sliding<void>(1);
  const firstPause = Duration.toMillis(options.firstPause ?? DEFAULT_FIRST_PAUSE_MS);
  const longestPause = Duration.toMillis(options.longestPause ?? DEFAULT_LONGEST_PAUSE_MS);
  // ⛔ ONE `connect()` IN FLIGHT AT A TIME. An attempt that times out is abandoned, but Bun's own
  //   promise is still pending (a name that does not resolve took 31 s), and a second `connect()`
  //   on top of it is not something Bun documents. The next attempt awaits the same promise.
  let connecting: Promise<void> | undefined;
  const connectOnce = (): Promise<void> => {
    connecting ??= client.connect().finally(() => {
      connecting = undefined;
    });
    return connecting;
  };
  const attempt = Effect.tryPromise({ try: connectOnce, catch: (cause) => cause }).pipe(
    Effect.timeoutOrElse({
      duration: options.connectionTimeout,
      orElse: () => Effect.fail(new Error('a reconnect attempt did not finish in time')),
    }),
    Effect.withSpan('valkey reconnect', { kind: 'client', attributes: options.attributes }),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  const reconnect = Effect.gen(function* () {
    if (client.connected) return;
    yield* Effect.logWarning('SeatState valkey: the connection is down, reconnecting');
    let pause = firstPause;
    let attempts = 0;
    while (!client.connected) {
      attempts += 1;
      yield* attempt;
      // ⚠️ `connected` decides, not the attempt's own answer: an attempt that resolved without the
      //   client being connected must pause like a failed one, not spin.
      if (client.connected) break;
      yield* Effect.sleep(pause);
      pause = Math.min(pause * 2, longestPause);
    }
    yield* Effect.logInfo(`SeatState valkey: reconnected after ${String(attempts)} attempt(s)`);
  });
  client.onclose = () => {
    Queue.offerUnsafe(wake, undefined);
  };
  // ⛔ A NO-OP, NEVER `null`: measured 2026-09-29 (Bun 1.4.0), `client.onclose = null` (or
  //   `undefined`) is accepted, and then `close()` calls the null and throws `TypeError: ... is not
  //   a function` (worded with whatever call site is on the stack, `c.close()` or a fiber's
  //   `this[args]()`). bun-types types `onclose` as `... | null`; Bun does not honour it.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      client.onclose = () => {};
    }),
  );
  yield* Effect.forkScoped(Effect.forever(Queue.take(wake).pipe(Effect.andThen(reconnect))));
});
