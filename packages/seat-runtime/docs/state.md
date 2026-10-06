# `SeatState`: Postgres and Valkey, on the `/state` subpath

A seat's durable state is Postgres (runs, resumes, results) and its fast state is Valkey (locks,
counters, caches). `@homeflare/seat-runtime/state` builds each as the **Effect service that already
exists for it**, so consumer code is ordinary Effect SQL and Redis:

| store    | service                                                           | from                                  |
| -------- | ----------------------------------------------------------------- | ------------------------------------- |
| Postgres | `SqlClient` (and `PgClient`, re-exported as `SeatState.PgClient`) | `@effect/sql-pg` 4.0.1, its own layer |
| Valkey   | `Redis` (`send`, `eval`; not `subscribe`)                         | `effect/persistence/Redis`            |

```ts
import { Effect, Redacted } from 'effect';
import * as Redis from 'effect/persistence/Redis';
import * as SqlClient from 'effect/sql/SqlClient';
import { SeatState } from '@homeflare/seat-runtime/state';

const state = SeatState.layer({
  postgres: { url: Redacted.make(pgDsn) }, // postgres://user:pass@host:5432/db
  valkey: { url: Redacted.make(vkUrl) }, // redis://seat:pass@host:6381
});
// or, each read from an environment variable: SEAT_POSTGRES_URL and SEAT_VALKEY_URL
const fromEnv = SeatState.layerFromEnv();

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const redis = yield* Redis.Redis;
  yield* sql`insert into runs (id) values (${id})`;
  yield* redis.send('SET', `seat:run:${id}`, 'started');
}).pipe(Effect.provide(state));
```

`SeatState.postgres`, `postgresFromEnv`, `valkey`, `valkeyFromEnv`, `layer` and `layerFromEnv` are
the constructors. Each `*FromEnv` takes `{ variable }` to read another name. ⛔ **This package holds
no host**: every URL is the consumer's, held `Redacted`, and no default points anywhere.

## Building a layer connects

Both layers connect and authenticate when they are built, so a wrong URL, user or password fails at
**startup** as a typed error (`SqlError`, `RedisError`, or `ConfigError` for a missing variable), not
at the first query. Postgres runs `select 1`; Valkey runs `connect()`. Each is bounded:
`connectTimeout` (Postgres) and `connectionTimeout` (Valkey), 5 s by default. A Valkey server that is
down is retried until that timeout, so one that is a moment late is waited for.

## A Valkey that goes away, and comes back

Commands fail **at once** while the connection is down (`RedisError`, the offline queue is off), and
the seat retries in Effect, where an attempt is a span. What makes that retry worth anything is that
**the layer reconnects itself**: 🔴 measured 2026-09-29 (Bun 1.4.0, default `maxRetries` 20), a
`Bun.RedisClient` retries on its own for about 31 s of outage and then GIVES UP, after which it stays
dead (`Connection has failed`) even when the server is back, until `connect()` is called again. The
review that found it measured the same cliff between 30 s (recovered) and 45 s (not). So a seat whose
Valkey restarted for a minute lost it until the process restarted.

Off Bun's `onclose` the layer now calls `connect()` again: one attempt at a time, each bounded by
`connectionTimeout`, pausing 250 ms doubling to 5 s between attempts, with one `valkey reconnect`
span per attempt, a warning when it starts and an info line when it succeeds. It stops with the
layer's scope. `maxRetries` (option) sets when this loop takes over from Bun's. Measured through the
layer with the DEFAULT budget (scratch server, `connectionTimeout` 3 s): after a 45 s outage the first
`PING` was answered 1.5 s after the server returned, after a 75 s outage 1.8 s. The test suite uses
`maxRetries: 2`, which makes Bun give up after about 0.3 s.

- ⛔ `onclose` also runs for every failed `connect()` and for the client's own `close()`, so it is a
  hint: the loop runs only while `client.connected` is false.
- 🔴 **`client.onclose = null` breaks `close()`.** Bun accepts it, and `close()` then calls the null
  and throws `TypeError: ... is not a function` (worded with whatever call site is on the stack).
  The layer assigns a no-op instead.

## The typed error for an out-of-prefix write

Every Valkey failure is Effect's `RedisError` (`_tag: 'RedisError'`, so `Effect.catchTag` works).
`SeatState.isPermissionDenied(error)` says whether it is the server's `NOPERM`: a key outside the
seat user's prefix, or a command outside its categories. Measured 2026-09-29 against a scratch
Valkey 9.1.1 with `user default off` and `user seat on >… ~seat:* +@all -@dangerous`:

| call                         | result                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| no credentials               | layer build fails, `NOAUTH` (`ERR_REDIS_AUTHENTICATION_FAILED`)                   |
| wrong password               | layer build fails, `Connection closed` (Bun's text for a server that is down too) |
| `SET seat:a` / `GET seat:a`  | ok                                                                                |
| `SET other:a`, `GET other:a` | `RedisError`, `NOPERM No permissions to access a key`                             |
| `FLUSHALL`                   | `RedisError`, `NOPERM User seat has no permissions to run the 'flushall' command` |

The layer stays usable after a denied call. The URL carries the user and password, percent-encoded
(`redis://seat:p%40ss@host:6381`); `rediss://` is TLS (not tested).

## In the trace

- **Postgres:** `@effect/sql-pg` makes one `sql.execute` client span per statement, with
  `db.system.name=postgresql`, `db.namespace`, `server.address`, `server.port` and `db.query.text`.
  The text holds `$1` placeholders, never a parameter value (asserted).
- **Valkey:** one client span per command, named `valkey <COMMAND>`, with `db.system.name=redis`
  (the OpenTelemetry registry has `redis` and no `valkey`, read 2026-09-29), `db.operation.name`,
  `server.address`, `server.port` and the database index as `db.namespace`. ⛔ The span's ATTRIBUTES
  never hold a key, a value or the URL's user or password (asserted in process and in the exported
  OTLP payload).

🔴 **A failed span is not only its attributes.** `OtlpTracer` exports the error a failed span ended
with as `exception.message` and `exception.stacktrace`, with the whole `cause` chain, so an error
text that quotes an argument carries it into the trace. Measured 2026-09-29 with canary values, in
the exported payload:

- **Valkey** quotes them in `ERR unknown command 'JSON.SET', with args beginning with: '<key>'
'<value>'` and `ERR unknown subcommand '<key>'`. ✅ **Scrubbed:** the error that leaves the layer is
  a new `Error` with the arguments cut (`src/state-valkey-scrub.ts`), asserted on the wire.
- **Postgres** quotes them in `invalid input syntax for type integer: "<value>"`, which rides in the
  `[cause]` of the exported stack. ⚠️ **Not scrubbed:** `@effect/sql-pg` builds the span and the error
  itself and has no hook, so a test pins the leak (`tests/state-error-text.test.ts`).

A Valkey text that echoes an argument without quotes, and the text a Lua script raises itself
(`error(...)` comes back as `ERR user_script:1: <text>`), are not covered. For Postgres, do not put a
secret in a parameter whose type the server can reject, or keep the exporter's destination one you
trust with seat data; a scrub in `SeatObs` would cover it and was not built (it would change every span).

Both spans join the trace of the run that made the call, and `SeatObs` exports them: asserted against
the stub's OTLP payload (`db.system.name` with `postgresql` or `redis`, the span names, no secret in a
SUCCESSFUL call). Ingest by the live VictoriaTraces is not measured, as for the rest of this package.

## Measured traps, and what this package does about each

Measured 2026-09-29, Bun 1.4.0, `@effect/sql-pg` rc.115, Valkey 9.1.1, Postgres 18.6.

- 🔴 **A DSN that will not parse leaks through the driver's error.** `@effect/sql-pg` fails it as
  `SqlError` whose `cause` is the URL `TypeError`, and that carries the whole string, password
  included: three of six bad DSNs tried leaked through `JSON.stringify` and `Bun.inspect`. `postgres`
  parses the URL first, and a string `new URL` rejects fails with a message that names the reason.
- 🔴 **The driver ignores the URL when it labels spans.** From `url` alone every query says
  `server.address: localhost`, `server.port: 5432`, `db.namespace: postgres`. `postgres` passes the
  URL's host, port, database and user as discrete fields too (except when a `?host=`, `?port=`,
  `?user=` or `?dbname=` in the URL overrides them, where the driver's reading stands).
- 🔴 **A `Bun.RedisClient` on its defaults waits forever for a server that is gone.** A command sent
  to a dead port sat unresolved past 8 s. The layer turns the offline queue off (through the layer, a
  command after the server was killed failed in 1 ms, and the first one after a restart succeeded
  within 0.5 s; `tests/state-valkey.test.ts` holds it) and
  gives every command a deadline (`commandTimeout`, 10 s) against a server that holds the socket
  open and says nothing. Past Bun's retry budget it reconnects itself (above).
- 🔴 **`connectionTimeout` does not bound DNS.** A name that does not resolve took 31 s with
  `connectionTimeout: 700`; the layer wraps `connect()` in an Effect timeout of the same length.
- ⚠️ **Not `BunRedis` from `@effect/platform-bun`.** Rc.115 ships one, but depending on
  `@effect/platform-bun` puts the `platform-node-shared` trap ([pairing.md](./pairing.md)) on every
  consumer. This is the same `send` over `client.send`, plus the two things above.
- ⚠️ **`sql-pg` rc.115 has no driver package**: it speaks the wire protocol over `node:net`, one peer
  (`effect`), no dependency. The Postgres half runs under Bun and Node; the Valkey half needs Bun
  (`Bun.RedisClient`), and building it under Node fails as `RedisError` saying so.
- ⚠️ **A consumer typechecking with `skipLibCheck: false` needs `@types/node`** for `/state`: `sql-pg`'s
  own `.d.ts` names `node:stream` and `node:tls` (4 `TS2591` errors, upstream's; `scripts/smoke.ts`
  allows exactly those).

## What is not here

- **No `subscribe`.** `Redis.subscribe` fails with `RedisError`: a subscriber needs a connection of
  its own. (`BunRedis` opens one, without reconnect.)
- ⚠️ **`commandTimeout` (10 s) applies to every command**, a blocking one (`BLPOP`, `XREAD BLOCK`)
  included: raise it, or such a call fails as `RedisError` at the deadline.
- No migrations, no schema, no key-prefix helper (the server's ACL is the enforcement), no metrics
  of its own (the spans are the signal).
- **UNVERIFIED:** `rediss://` TLS; a password rotated while the server was down (the loop would
  retry an authentication that fails, one `valkey reconnect` span per attempt, and never stop); and
  the seats' real stores: `valkey-seats :6381` was not listening on CT100 (`ss`, 2026-09-29) and no
  test used the `hf_agent` role. Everything above ran against scratch stores. The Postgres suite ran
  twice: once against a scratch database on CT100 (trust auth, through an ssh tunnel), once against a
  local scram-sha-256 Postgres 18 (which is what runs the wrong-password test).

## The tests, and running them

`bun test packages/seat-runtime` runs everything that needs no server (DSN parsing, the failures, the
command deadline, the spans against a fake client). Two suites need a store and **skip, loudly, when
it is missing** (CI has neither); `SEAT_RUNTIME_REQUIRE_SERVERS=1` makes a missing store a failure.

- **Valkey:** a `valkey-server` (or `redis-server`) on `PATH`. The tests start it on a loopback port
  with `user default off` and one `seat` user on `~seat:*`, with a per-run password.
- **Postgres:** `SEAT_RUNTIME_TEST_POSTGRES_URL` naming a **scratch** database. The tests create one
  table with a per-run name and drop it. A URL with a password (scram-sha-256) also runs the
  wrong-password test; a trust-auth one skips it.
