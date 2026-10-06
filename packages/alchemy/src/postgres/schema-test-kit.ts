/**
 * Shared wiring for the runner-transport `Postgres.Schema` handler tests: the recording
 * `PsqlRunner` (every stdin and its `psql` argv), the handler-argument builders, and the
 * one SQL router they all answer through.
 *
 * ⚠️ THE ROUTER ORDER IS LOAD-BEARING (`schema-sql.ts`): the emptiness check's `WITH`
 *   contains `FROM pg_namespace`, and the schema row SELECT contains
 *   `current_database() AS database` — so `AS empty` must be matched before
 *   `FROM pg_namespace`, and `FROM pg_namespace` before `current_database()`. The database
 *   probe (`SELECT 1 AS present FROM pg_database`, `database-sql.ts`) carries no other
 *   branch's marker and matches its own.
 */
import type { PsqlRunner } from './psql-executor.ts';
import { stripPin } from './search-path.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';

export const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });

/** One answer per statement shape a handler issues; `undefined` falls through the router. */
export interface RouteAnswers {
  /** `schemaIsEmpty` — the pre-DROP emptiness check (`cascade` unset). */
  readonly empty?: string;
  /** `selectSchema` — the schema row re-read, or `[]` for an absent schema. */
  readonly schema?: string;
  /** `databaseExists` — `[{\"present\":1}]` when the declared database exists, `[]` when not. */
  readonly probe?: string;
  /** `current_database()` — the proof that the override reached the declared database. */
  readonly proof?: string;
}

/** Route one stdin to its answer by the markers above, `undefined` when no branch matches. */
export const route = (stdin: string, answers: RouteAnswers): string | undefined => {
  // The atomic drop (`schema-drop-sql.ts`) quotes every marker below inside its body: it answers
  // nothing, and a refusal is injected by `runnerWith`'s `failOn`, never routed.
  if (stdin.startsWith('DO ')) return undefined;
  if (stdin.includes('AS empty')) return answers.empty;
  if (stdin.includes('FROM pg_catalog.pg_namespace')) return answers.schema;
  if (stdin.includes('FROM pg_catalog.pg_database')) return answers.probe;
  if (stdin.includes('current_database()')) return answers.proof;
  return undefined;
};

/** A `router` that answers every stdin (unrouted statements answer the empty string). */
export const router = (answers: RouteAnswers) => (stdin: string) => route(stdin, answers) ?? '';

/**
 * A recording `PsqlRunner`: every stdin and the `psql` argv are kept, each stdin answered by
 * `answers`. The argv recording pins the `-d` database each statement ran against — the last
 * element of the argv is the `psql -d` value (`psql-executor.ts`).
 */
export const runnerWith = (
  answers: (stdin: string) => string,
  /** The `psql` stderr a statement fails with (exit 3), or `undefined` to answer normally. */
  failOn: (stdin: string) => string | undefined = () => undefined,
): { run: PsqlRunner; stdins: string[]; argvs: Array<readonly string[]> } => {
  const stdins: string[] = [];
  const argvs: Array<readonly string[]> = [];
  return {
    // The pin prefix (`search-path.ts`) is stripped: these tests assert the STATEMENT. The pin
    // itself is asserted once, on the raw stdin, in `search-path.test.ts`.
    run: ({ stdin: raw, argv }) => {
      const stdin = stripPin(raw);
      stdins.push(stdin);
      argvs.push(argv);
      const stderr = failOn(stdin);
      return Promise.resolve(
        stderr === undefined
          ? { code: 0, stdout: answers(stdin), stderr: '' }
          : { code: 3, stdout: '', stderr },
      );
    },
    stdins,
    argvs,
  };
};

/** The handler inputs the engine passes on `delete`. `output` is the persisted state — the
 * `oid` + `owner` the last reconcile asserted, which delete must prove the live row still
 * matches before it drops (`schema-delete.ts`). */
export const deleteArgs = (olds: PostgresSchemaProps, output: PostgresSchemaAttributes) => ({
  id: 'x',
  fqn: 'x',
  instanceId: 'x',
  olds,
  output,
  session: undefined as never,
  bindings: [] as never,
});

/** The handler inputs the engine passes on `read` (undefined output is the adopt path). */
export const readArgs = (olds: PostgresSchemaProps) => ({
  id: 'x',
  fqn: 'x',
  instanceId: 'x',
  olds,
  output: undefined,
  session: undefined as never,
  bindings: [] as never,
});
