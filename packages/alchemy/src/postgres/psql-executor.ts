/**
 * A `PgExecutor` that runs SQL through a caller-supplied command runner instead of a socket.
 *
 * For a host whose Postgres listens on loopback only inside a container (CT100: rootful podman
 * container `postgres`, local socket, user `postgres`, no password): the consumer's runner is
 * `ssh <host> sudo -n podman exec -i postgres <argv…>`, and this file only builds the `psql`
 * argv and stdin and parses the answer.
 *
 * ⛔ NO ESTATE VALUE LIVES HERE (public kit). The ssh destination, container name and sudo
 *   allowlist are the runner's, in the consuming stack.
 * ⛔ `psql` HAS NO BIND PARAMETERS OVER STDIN. Every `$n` is replaced by a `quoteStringLiteral`
 *   literal, and ONLY string params are accepted — this family binds a database or role name,
 *   nothing else — so a number or object is a refusal, never silently stringified.
 * ★ ROWS COME BACK AS JSON: a `SELECT` is wrapped in `json_agg`, so `oid` and `datconnlimit`
 *   arrive as JS numbers exactly as the socket client decodes them (database-sql.ts, no bigint).
 * ★ `VERBOSITY=verbose` puts the SQLSTATE in the error line, so `42P04` (duplicate database)
 *   stays recognisable to `isDuplicateDatabaseRace`.
 */
import * as Effect from 'effect/Effect';
import {
  ConnectionError,
  SqlError,
  SqlSyntaxError,
  UnknownError,
} from 'effect/unstable/sql/SqlError';
import { type PgExecutor, quoteStringLiteral } from './database-sql.ts';

export interface PsqlResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one `psql` argv (starting with `psql`) with `stdin` and answers its exit. The consumer's
 * implementation prepends the transport (`ssh … sudo -n podman exec -i <container>`) and owns
 * the timeout and output bound: the kit sets neither. */
export type PsqlRunner = (call: {
  readonly argv: readonly string[];
  readonly stdin: string;
}) => Promise<PsqlResult>;

export interface PsqlTarget {
  readonly database: string;
  readonly username: string;
}

/** Replace `$1…$n` with string literals; refuses a non-string param or a missing one. */
export const inlineParams = (sql: string, params: ReadonlyArray<unknown>): string =>
  params.length === 0
    ? sql
    : sql.replace(/\$(\d+)/g, (_match, index: string) => {
        const value = params[Number(index) - 1];
        if (typeof value !== 'string') {
          throw new Error(`psql executor: param $${index} must be a string, got ${typeof value}`);
        }
        return quoteStringLiteral(value);
      });

/** Postgres `to_json` emits the `oid` type as a string; the socket driver returns a number. */
const normalizeRow = (row: unknown): unknown =>
  typeof row === 'object' && row !== null && typeof (row as { oid?: unknown }).oid === 'string'
    ? { ...row, oid: Number((row as { oid: string }).oid) }
    : row;

const isSelect = (sql: string): boolean => /^\s*SELECT\b/i.test(sql);

const wrapRows = (sql: string): string =>
  `SELECT coalesce(json_agg(t), '[]'::json)::text FROM (${sql}) t;`;

/** A password literal must not survive into an error Alchemy logs. `ALTER ROLE … PASSWORD`
 * inlines the value (Postgres has no bind form), and the runner turns the first 40 characters
 * of that statement into `operation` and the full `stderr` into `message`. */
export const redactPasswordLiterals = (text: string): string =>
  text.replace(/PASSWORD\s+'(?:[^']|'')*'/gi, "PASSWORD '[redacted]'");

const failure = (operation: string, result: PsqlResult): SqlError => {
  const state = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
  const stderr = redactPasswordLiterals(result.stderr.trim());
  const fields = {
    cause: Object.assign(new Error(stderr), state === undefined ? {} : { code: state }),
    message: stderr,
    operation: redactPasswordLiterals(operation),
  };
  const reason =
    state === undefined
      ? new ConnectionError(fields)
      : state.startsWith('42')
        ? new SqlSyntaxError(fields)
        : new UnknownError(fields);
  return new SqlError({ reason });
};

export const makePsqlExecutor = (run: PsqlRunner, target: PsqlTarget): PgExecutor => ({
  unsafe: <A extends object>(sql: string, params: ReadonlyArray<unknown> = []) =>
    Effect.gen(function* () {
      const inlined = yield* Effect.try({
        try: () => inlineParams(sql, params),
        catch: (cause) =>
          new SqlError({ reason: new UnknownError({ cause, operation: 'psql inline params' }) }),
      });
      const rows = isSelect(inlined);
      const result = yield* Effect.tryPromise({
        try: () =>
          run({
            argv: [
              'psql',
              '-X',
              '-q',
              '-A',
              '-t',
              '-v',
              'ON_ERROR_STOP=1',
              '-v',
              'VERBOSITY=verbose',
              '-U',
              target.username,
              '-d',
              target.database,
            ],
            stdin: rows ? wrapRows(inlined) : `${inlined};`,
          }),
        catch: (cause) =>
          new SqlError({ reason: new ConnectionError({ cause, operation: 'psql exec' }) }),
      });
      if (result.code !== 0) {
        return yield* Effect.fail(failure(redactPasswordLiterals(inlined).slice(0, 40), result));
      }
      if (!rows) return [] as ReadonlyArray<A>;
      const parsed = yield* Effect.try({
        try: () => (JSON.parse(result.stdout.trim() || '[]') as unknown[]).map(normalizeRow),
        catch: (cause) =>
          new SqlError({ reason: new UnknownError({ cause, operation: 'psql parse output' }) }),
      });
      return parsed as ReadonlyArray<A>;
    }),
});
