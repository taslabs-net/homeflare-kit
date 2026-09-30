/**
 * Where a Valkey instance's socket comes from, and how each lifecycle operation gets an executor.
 *
 * ⛔ NO ESTATE VALUE LIVES HERE. The kit is PUBLIC; CT100's host, the two ports (6380/6381) and the
 *   ACL user a seat authenticates as are the CONSUMING stack's values, passed to
 *   `valkeyConnection(...)` in a house stack — never a default, never a fallback. The mini's own
 *   Valkey, or any later host, is a different `valkeyConnection` call, not a constant.
 * ★ A LAZY `Context.Service` WHOSE VALUE IS AN `Effect` (S24) — the same shape `PostgresConnection`
 *   uses. `host` and `port` carry no secret; the ACL user's PASSWORD is not a prop here (S25): the
 *   `Valkey.AclFile` resource seals passwords by reference, and the connection itself authenticates
 *   with `AUTH` only when a stack supplies a password through `valkeyConnection`'s `password`
 *   reference — resolved at call time, never stored.
 * ★ ONE SOCKET PER OPERATION, OPENED AND CLOSED IN A SCOPE. `withValkey` opens a `node:net` socket
 *   for the operation, runs it, and closes the socket when it finishes — one connection per
 *   `reconcile`, never held across a whole plan.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { type Socket, connect } from 'node:net';
import { type Environment, type FromEnv, resolveAll } from '../secrets/write-only.ts';
import { ValkeyAuthPasswordMissing } from './errors.ts';
import {
  DEFAULT_SOCKET_TIMEOUT_MS,
  type ValkeyExecutor,
  ValkeyServerError,
  ValkeySocketError,
  type ValkeyTransportError,
  makeSocketExecutor,
} from './transport.ts';

/** What a stack passes to reach one instance. `host`/`port` are the TCP endpoint; the ACL
 * `username` and optional `password` (a `FromEnv` reference, never a value) are the credentials a
 * stack authenticates with. Omitting both sends no `AUTH` — a bare `default` connection, which is
 * correct only for a scratch instance a test owns.
 *
 * ⛔ A USERNAME REQUIRES A PASSWORD. The discriminated union makes `username` without `password`
 *   unrepresentable: on an instance whose `default` user is off (CT100's ACL files ship `user
 *   default off`), a username-only connection cannot authenticate at all, and silently skipping
 *   `AUTH` would surface much later as a confusing `NOAUTH` from the first command. The bare
 *   branch carries `username?: undefined` — a type marker, not a prop — so `config.username`
 *   reads on the whole union without narrowing first.
 *
 * `timeoutMs` bounds connect, each read, and the socket idle timer (default 10s). A blackholed
 * host must stall a plan no longer than that deadline. */
export type ValkeyConnectionConfig = {
  readonly host: string;
  readonly port: number;
  /** Per-connect/per-read deadline in ms. */
  readonly timeoutMs?: number;
} & (
  | { readonly username?: undefined }
  | {
      readonly username?: string;
      readonly password: FromEnv;
    }
);

/** The lazy connection service (S24): its value is an `Effect` of the config, resolved inside each
 * operation so an environment variable is read at call time, never at layer build. */
export class ValkeyConnection extends Context.Service<
  ValkeyConnection,
  Effect.Effect<ValkeyConnectionConfig>
>()('Valkey.Connection') {}

/** A stack's one-line way to provide an instance: `Layer.provide(valkeyConnection({ … }))` on the
 * provider layer, or merged into the stack's own layer tree. */
export const valkeyConnection = (config: ValkeyConnectionConfig): Layer.Layer<ValkeyConnection> =>
  Layer.succeed(ValkeyConnection, Effect.succeed(config));

const openSocket = (
  host: string,
  port: number,
  timeoutMs: number,
): Effect.Effect<Socket, ValkeySocketError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host, port });
        let settled = false;
        const onConnect = () => {
          if (settled) return;
          settled = true;
          socket.off('error', onError);
          socket.off('timeout', onTimeout);
          signal.removeEventListener('abort', onAbort);
          clearTimeout(timer);
          socket.setTimeout(0);
          resolve(socket);
        };
        const onError = (error: Error) => {
          if (settled) return;
          settled = true;
          socket.off('connect', onConnect);
          socket.off('timeout', onTimeout);
          signal.removeEventListener('abort', onAbort);
          clearTimeout(timer);
          socket.destroy();
          reject(new ValkeySocketError({ reason: error.message }));
        };
        const onTimeout = () => onError(new Error('connect timed out'));
        const onAbort = () => onError(new Error('connect interrupted'));
        // `node:net`'s own connect timeout is minutes-long and not configurable. Both the
        // abort and `socket.setTimeout` bound the handshake; the read deadline is separate
        // (a host that accepts and then sends nothing has already connected).
        const timer = setTimeout(onTimeout, timeoutMs);
        timer.unref();
        socket.setTimeout(timeoutMs);
        signal.addEventListener('abort', onAbort);
        socket.once('connect', onConnect);
        socket.once('error', onError);
        socket.once('timeout', onTimeout);
      }),
    catch: (cause) =>
      cause instanceof ValkeySocketError ? cause : new ValkeySocketError({ reason: String(cause) }),
  });

/** `AUTH` when the config carries a password, resolved at call time; a missing or empty variable
 * is the typed `ValkeyAuthPasswordMissing` (S21: a fact this family checked, not a sniffed server
 * reply). A password without a username authenticates as `default`. */
const auth = (
  executor: ValkeyExecutor,
  config: ValkeyConnectionConfig,
  env: Environment,
): Effect.Effect<void, ValkeyTransportError | ValkeyAuthPasswordMissing> => {
  if (!('password' in config)) return Effect.void;
  const { username, password } = config;
  return Effect.gen(function* () {
    const { values, missing } = resolveAll({ password }, env);
    const value = values.password;
    if (missing.length > 0 || value === undefined) {
      return yield* Effect.fail(
        new ValkeyAuthPasswordMissing({ username, variable: password.fromEnv }),
      );
    }
    const reply = yield* executor.send(
      username === undefined ? ['AUTH', value] : ['AUTH', username, value],
    );
    if (reply.kind === 'error')
      return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
  });
};

/**
 * Run one operation against a freshly opened, freshly closed socket. Every `read` and `reconcile`
 * in this family calls this once for the whole operation, never once per command.
 */
export const withValkey = <A, E>(
  build: (
    executor: ValkeyExecutor,
    config: ValkeyConnectionConfig,
  ) => Effect.Effect<A, E | ValkeyTransportError>,
): Effect.Effect<A, E | ValkeyTransportError | ValkeyAuthPasswordMissing, ValkeyConnection> =>
  Effect.gen(function* () {
    const resolveConfig = yield* ValkeyConnection;
    const config = yield* resolveConfig;
    const timeoutMs = config.timeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
    const socket = yield* openSocket(config.host, config.port, timeoutMs);
    // Listener first, then the idle deadline. A timeout destroys with an error, and Node
    // exits the process if that `error` event has no listener.
    const executor = makeSocketExecutor(socket, timeoutMs);
    socket.setTimeout(timeoutMs);
    const onIdle = () => {
      socket.destroy(new Error('socket timed out'));
    };
    socket.on('timeout', onIdle);
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        yield* auth(executor, config, process.env);
        return yield* build(executor, config);
      }),
      Effect.sync(() => {
        socket.setTimeout(0);
        socket.off('timeout', onIdle);
        socket.destroy();
      }),
    );
  });
