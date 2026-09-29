/**
 * Reading a connection string without ever printing it.
 *
 * ⛔ A DSN CARRIES A PASSWORD, so nothing here returns, throws or formats the string itself: a
 *   caller gets back the few non-secret fields (host, port, database, user name) or `undefined`.
 * 🔴 WHY THIS EXISTS AT ALL. Measured 2026-09-29 (`@effect/sql-pg` rc.115, Bun 1.4.0): a DSN that
 *   `new URL` cannot parse fails as `SqlError` -> `ConnectionError` whose `cause` is the URL
 *   `TypeError`, and that error's text carries the WHOLE string, password included. Three of the
 *   six bad DSNs tried leaked it through `JSON.stringify` and `Bun.inspect` alike. Parsing here
 *   first, with the same `new URL`, means a string that would leak never reaches the driver:
 *   what the driver still rejects (a wrong scheme, an `sslmode` it lacks) echoes only that one
 *   token, not the string.
 * 🔴 THE SECOND REASON: `@effect/sql-pg` labels every query span from its discrete config fields
 *   and IGNORES the URL for that. A client built from `url` alone exports
 *   `server.address: localhost`, `server.port: 5432` and `db.namespace: postgres` for EVERY
 *   query whatever it is connected to (measured 2026-09-29 against CT100's Postgres through a
 *   tunnel), so a trace would point at the wrong database. `postgresFields` hands the driver the
 *   same host, port, database and user the URL names, decoded the way the driver decodes them.
 */

/** The non-secret fields a Postgres URL names; a field the URL leaves out is absent. */
export type PostgresFields = {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly database?: string | undefined;
  readonly username?: string | undefined;
};

/** The non-secret fields a Valkey URL names; `port` defaults to 6379 for a TCP scheme. */
export type ValkeyFields = {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  /** The logical database index (`redis://host/1`), when there is one. */
  readonly database?: string | undefined;
};

/**
 * Query keys that OVERRIDE the authority in `@effect/sql-pg`'s own parser (rc.115 `parseUrl`).
 * ⚠️ When a URL carries one, the fields below would be a second, conflicting answer (explicit
 *   config wins over the URL), so none are derived and the driver's reading stands.
 */
const OVERRIDING_KEYS: ReadonlySet<string> = new Set(['host', 'port', 'user', 'dbname']);

/** `decodeURIComponent` that reports failure as `undefined` instead of throwing its message. */
function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** `new URL` that reports failure as `undefined`: its `TypeError` carries the string. */
function parse(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/**
 * `undefined` when `dsn` is not a URL at all (the one case the driver would leak on); otherwise
 * the fields it names, or none when the URL is one the driver should read alone.
 */
export function postgresFields(dsn: string): PostgresFields | undefined {
  const url = parse(dsn);
  if (url === undefined) return undefined;
  for (const key of url.searchParams.keys()) if (OVERRIDING_KEYS.has(key)) return {};
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : decode(url.hostname);
  const database = decode(url.pathname.replace(/^\//, ''));
  const username = decode(url.username);
  const port = url.port === '' ? undefined : Number(url.port);
  // ⚠️ A piece that will not decode or parse is left to the driver, which fails with its own
  //   message (it names a port or a component, never the string).
  if (hostname === undefined || database === undefined || username === undefined) return {};
  if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return {};
  return {
    host: hostname === '' ? undefined : hostname,
    port,
    database: database === '' ? undefined : database,
    username: username === '' ? undefined : username,
  };
}

/** The URL schemes `Bun.RedisClient` accepts (its own error names exactly these seven). */
const VALKEY_SCHEMES: ReadonlySet<string> = new Set([
  'redis:',
  'valkey:',
  'rediss:',
  'valkeys:',
  'redis+tls:',
  'redis+unix:',
  'redis+tls+unix:',
]);

/** `undefined` when `raw` is not a URL of a scheme `Bun.RedisClient` takes. */
export function valkeyFields(raw: string): ValkeyFields | undefined {
  const url = parse(raw);
  if (url === undefined || !VALKEY_SCHEMES.has(url.protocol)) return undefined;
  if (url.protocol.endsWith('+unix:')) return {};
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const database = url.pathname.replace(/^\//, '');
  return {
    host: host === '' ? undefined : host,
    port: url.port === '' ? 6379 : Number(url.port),
    database: database === '' ? undefined : database,
  };
}
