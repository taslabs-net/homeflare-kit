/**
 * Valkey as Effect's own `Redis` service, over `Bun.RedisClient`.
 *
 * ★ `Redis.make` OVER THE BUILT-IN CLIENT, NOT `@effect/platform-bun`'s `BunRedis`. Rc.115 ships
 *   `BunRedis.layer`, and it would do; but a dependency on `@effect/platform-bun` drags
 *   `@effect/platform-node-shared ^rc.115` in behind it, which resolves to rc.118 on a fresh
 *   install and kills the process at import, and only a ROOT `overrides` fixes that (docs/pairing.md,
 *   measured 2026-09-29). A library cannot ship one. So this is the same ~30 lines (`send` over
 *   `client.send`), with the two things `BunRedis` lacks: a connection that must succeed before the
 *   layer is built, and a deadline on every command.
 * ⛔ THE URL CARRIES THE ACL USER (`redis://seat:<password>@host:port`, percent-encoded), measured
 *   2026-09-29 against a scratch Valkey with `user default off`: an unauthenticated client is
 *   refused `NOAUTH`; the seat user reads and writes its own prefix; a write outside it fails
 *   `NOPERM No permissions to access a key`, and a command outside its categories fails
 *   `NOPERM User seat has no permissions to run the 'flushall' command`. All of them arrive as
 *   `RedisError`, and `isPermissionDenied` names the two `NOPERM` ones.
 * ⛔ NO `subscribe`. `Redis.subscribe` here fails with `RedisError`: a Valkey subscriber needs a
 *   connection of its own that this layer does not open. (`BunRedis` opens one, with no reconnect;
 *   a caller that needs pub/sub can use it beside this layer.)
 * ⚠️ BUN ONLY, AND SAID SO AT THE FIRST USE. `Bun.RedisClient` is loaded with `import('bun')`, so
 *   importing this module under Node still works (the Postgres half is portable); BUILDING the
 *   Valkey layer there fails with a `RedisError` naming the reason.
 * 🔴 `connectionTimeout` DOES NOT BOUND DNS. Measured 2026-09-29: with `connectionTimeout: 700`, a
 *   host name that does not resolve failed after 31 s. `connect()` therefore also runs under an
 *   Effect timeout of the same length.
 * 🔴 BUN'S OWN RECONNECT ENDS, AND THE CLIENT THEN STAYS DEAD (about 31 s of outage here): the layer
 *   reconnects it itself, off `onclose` (state-valkey-connection.ts holds the measurement).
 */
import * as Config from 'effect/Config';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import * as Redis from 'effect/unstable/persistence/Redis';
import { valkeyFields } from './state-dsn.ts';
import { keepConnected } from './state-valkey-connection.ts';
import { instrumentedSend } from './state-valkey-send.ts';

export type ValkeyOptions = {
  /**
   * `redis://<user>:<password>@<host>:<port>[/<db>]` (or `valkey://`, `rediss://` for TLS), the
   * user and password percent-encoded. Held `Redacted`; never in a span, log or error. Required:
   * this package holds no host.
   */
  readonly url: string | Redacted.Redacted<string>;
  /**
   * How long to wait to connect and authenticate when the layer is built, and for each reconnect
   * attempt after Bun gives up. Default 5 s (Bun's own is 10 s). ⚠️ A finite positive duration of at
   * most 2 ** 31 - 1 ms, or a `RangeError` defect.
   */
  readonly connectionTimeout?: Duration.Input | undefined;
  /** How long one command may take. Default 10 s; same limits as `connectionTimeout`. */
  readonly commandTimeout?: Duration.Input | undefined;
  /**
   * How many times Bun retries a lost connection before it gives up (its default is 20, about 30
   * s of outage). After that THE LAYER reconnects until the server is back, so this only sets
   * when its own loop takes over. A non-negative integer, or a `RangeError` defect.
   */
  readonly maxRetries?: number | undefined;
};

export const DEFAULT_CONNECTION_TIMEOUT: Duration.Duration = Duration.seconds(5);
export const DEFAULT_COMMAND_TIMEOUT: Duration.Duration = Duration.seconds(10);

/** A duration as whole milliseconds Bun and `setTimeout` accept, or a `RangeError`. */
function milliseconds(input: Duration.Input, name: string): number {
  const ms = Duration.toMillis(input);
  if (!Number.isFinite(ms) || ms <= 0 || ms > 2 ** 31 - 1) {
    throw new RangeError(`${name} must be a finite duration above 0 and at most 2 ** 31 - 1 ms`);
  }
  return Math.ceil(ms);
}

/** A failure that names the reason and never the URL. */
const refused = (reason: string): Redis.RedisError =>
  new Redis.RedisError({ cause: new Error(`SeatState valkey: ${reason}`) });

/**
 * Whether `error` is the server's `NOPERM`: a key outside the user's prefix, or a command outside
 * its categories. ⚠️ It reads the message, because Bun reports both as one `code`
 * (`ERR_REDIS_SERVER_ERROR`) and the server's own text is the only thing that tells them apart
 * from a real server fault.
 */
export function isPermissionDenied(error: unknown): boolean {
  if (!(error instanceof Redis.RedisError)) return false;
  const cause: unknown = error.cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.startsWith('NOPERM');
}

/** Subscribing is not offered; see the header. */
const subscribe = (): Effect.Effect<never, Redis.RedisError> =>
  Effect.fail(refused('subscribe is not supported here (a subscriber needs its own connection)'));

/** Loads `Bun.RedisClient`, or fails naming why it is not there (Node, workerd). */
const loadClient = Effect.tryPromise({
  try: async () => (await import('bun')).RedisClient,
  catch: () => refused('needs Bun (Bun.RedisClient); this runtime does not have it'),
});

const build = Effect.fnUntraced(function* (options: ValkeyOptions) {
  const url = Redacted.value(
    typeof options.url === 'string' ? Redacted.make(options.url) : options.url,
  );
  const fields = valkeyFields(url);
  if (fields === undefined) {
    return yield* refused('the URL is not a redis, valkey, rediss or valkeys URL');
  }
  const connectionTimeout = options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT;
  const commandTimeout = options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT;
  const connectMs = milliseconds(connectionTimeout, 'connectionTimeout');
  const commandMs = milliseconds(commandTimeout, 'commandTimeout');
  const maxRetries = options.maxRetries;
  if (maxRetries !== undefined && !(Number.isInteger(maxRetries) && maxRetries >= 0)) {
    throw new RangeError('maxRetries must be a non-negative integer');
  }
  const RedisClient = yield* loadClient;
  // ⛔ OFFLINE QUEUE OFF: a command sent while the connection is down fails at once as
  //   `RedisError` (a seat retries in Effect, where an attempt is a span) instead of waiting for
  //   a reconnect that may not come. Measured 2026-09-29: after a server restart the same client
  //   answered again within 1.5 s; past Bun's retry budget the layer reconnects behind the
  //   caller's retry (state-valkey-connection.ts). It is also why the layer connects first: an
  //   unconnected client with the queue off refuses every command.
  const client = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        new RedisClient(url, {
          connectionTimeout: connectMs,
          enableOfflineQueue: false,
          ...(maxRetries === undefined ? {} : { maxRetries }),
        }),
      catch: () => refused('Bun.RedisClient refused the URL'),
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  yield* Effect.tryPromise({
    try: () => client.connect(),
    catch: (cause) => new Redis.RedisError({ cause }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: connectionTimeout,
      orElse: () => Effect.fail(refused(`did not connect within ${String(connectMs)} ms`)),
    }),
  );
  // ⚠️ Address and namespace only: the URL's user and password never reach an attribute.
  const attributes = {
    'db.system.name': 'redis',
    ...(fields.host === undefined ? {} : { 'server.address': fields.host }),
    ...(fields.port === undefined ? {} : { 'server.port': fields.port }),
    ...(fields.database === undefined ? {} : { 'db.namespace': fields.database }),
  };
  // ⛔ AFTER the first connect, so a wrong URL or password fails the build instead of being retried.
  yield* keepConnected(client, { connectionTimeout, attributes });
  return yield* Redis.make({
    send: instrumentedSend(client, { commandTimeout, commandTimeoutMs: commandMs, attributes }),
    subscribe,
  });
});

/**
 * The `Redis` service against one Valkey. ⛔ BUILDING IT CONNECTS AND AUTHENTICATES, so a wrong
 * URL, user or password fails at startup as `RedisError`, not at the first command (Bun reports a
 * refused password as `Connection closed`, the same text as a server that is down).
 * The client is closed when the layer's scope closes.
 */
export const valkey = (options: ValkeyOptions): Layer.Layer<Redis.Redis, Redis.RedisError> =>
  Layer.effect(
    Redis.Redis,
    Effect.suspend(() => build(options)),
  );

/** The environment variable `valkeyFromEnv` reads unless told another. Not a host. */
export const VALKEY_URL_VARIABLE = 'SEAT_VALKEY_URL';

export type ValkeyFromEnvOptions = Omit<ValkeyOptions, 'url'> & {
  /** The variable holding the URL. Default `SEAT_VALKEY_URL`. */
  readonly variable?: string | undefined;
};

/**
 * `valkey`, its URL read from an environment variable as a `Redacted` secret. A missing variable
 * fails as `ConfigError`, naming the variable and nothing else.
 */
export const valkeyFromEnv = (
  options?: ValkeyFromEnvOptions,
): Layer.Layer<Redis.Redis, Redis.RedisError | Config.ConfigError> => {
  const { variable, ...rest } = options ?? {};
  return Layer.unwrap(
    Config.Redacted(variable ?? VALKEY_URL_VARIABLE).pipe(
      Effect.map((url) => valkey({ ...rest, url })),
    ),
  );
};
