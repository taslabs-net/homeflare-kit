/**
 * `Postgres.Grants` opens its declared database the way `Postgres.Schema` does. The family
 * connection points at a maintenance database; a cold plan must not connect to a database
 * that does not exist yet, and a delete of a dropped database must not fail on connect.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PsqlRunner } from './psql-executor.ts';
import { postgresRunnerConnection } from './connection.ts';
import { postgresGrantsHandlers } from './grants.ts';
import { PostgresGrantsDatabaseMismatch, PostgresGrantsDatabaseMissing } from './grants-errors.ts';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';

const declared: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
};

/** The engine passes persisted attributes into `delete`. These tests return before that
 * state is read — absence is decided by `pg_database`, and the present-database path
 * stops at a missing role — so the words are empty. */
const persisted: PostgresGrantsAttributes = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaPrivileges: [],
  tables: [],
  columns: [],
  defaults: [],
  publicSchemaRevoked: false,
  publicTablesRevoked: false,
  schemaOwnedByRole: false,
  ownedTables: [],
};

const handlerArgs = {
  id: 'x',
  fqn: 'x',
  instanceId: 'x',
  session: undefined as never,
  bindings: [] as never,
};

const recording = (probe: string, proof: string) => {
  const stdins: string[] = [];
  const argvs: Array<readonly string[]> = [];
  const run: PsqlRunner = ({ stdin, argv }) => {
    stdins.push(stdin);
    argvs.push(argv);
    const stdout = stdin.includes('FROM pg_database')
      ? probe
      : stdin.includes('current_database()')
        ? proof
        : '[]';
    return Promise.resolve({ code: 0, stdout, stderr: '' });
  };
  return { run, stdins, argvs };
};

const provide = (run: PsqlRunner) =>
  postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' });

if (postgresGrantsHandlers.read === undefined || postgresGrantsHandlers.reconcile === undefined) {
  throw new Error('Postgres.Grants is missing its read or reconcile handler');
}
const grantsRead = postgresGrantsHandlers.read;
const grantsReconcile = postgresGrantsHandlers.reconcile;

describe('a missing declared database is absent', () => {
  test('delete is a no-op and never connects to the dropped database', async () => {
    const { run, stdins, argvs } = recording('[]', '[{"database":"agents"}]');
    const result = await Effect.runPromise(
      postgresGrantsHandlers
        .delete({ ...handlerArgs, olds: declared, output: persisted })
        .pipe(Effect.provide(provide(run))),
    );
    // The no-op resolves cleanly: only the family-connection probe ran, so no
    // current_database()/GRANT/REVOKE ever targeted the (absent) declared database.
    expect(result).toBeUndefined();
    expect(stdins.length).toBe(1);
    expect(stdins[0]).toContain('FROM pg_database');
    expect(stdins[0]).not.toContain('current_database()');
    expect(argvs[0]?.at(-1)).toBe('postgres');
  });

  test('read answers absent without connecting to the declared database', async () => {
    const { run, stdins, argvs } = recording('[]', '[{"database":"agents"}]');
    const result = await Effect.runPromise(
      grantsRead({ ...handlerArgs, olds: declared, output: undefined }).pipe(
        Effect.provide(provide(run)),
      ),
    );
    expect(result).toBeUndefined();
    expect(stdins.length).toBe(1);
    expect(argvs[0]?.at(-1)).toBe('postgres');
  });
});

describe('a present database is opened and proved', () => {
  test('delete probes the family connection, then proves current_database() on the declared one', async () => {
    const { run, stdins, argvs } = recording('[{"present":1}]', '[{"database":"agents"}]');
    await Effect.runPromise(
      postgresGrantsHandlers
        .delete({ ...handlerArgs, olds: declared, output: persisted })
        .pipe(Effect.provide(provide(run))),
    );
    expect(argvs[0]?.at(-1)).toBe('postgres');
    expect(stdins[0]).toContain('FROM pg_database');
    expect(argvs.slice(1).every((argv) => argv.at(-1) === 'agents')).toBe(true);
    expect(stdins[1]).toContain('current_database()');
  });

  test('reconcile opens the declared database and refuses when current_database() disagrees', async () => {
    const { run, stdins, argvs } = recording('[{"present":1}]', '[{"database":"postgres"}]');
    const error = await Effect.runPromise(
      Effect.flip(
        grantsReconcile({
          ...handlerArgs,
          news: declared,
          olds: declared,
          output: undefined,
        }).pipe(Effect.provide(provide(run))),
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsDatabaseMismatch);
    expect(error).toMatchObject({ declared: 'agents', connected: 'postgres' });
    // The reconcile probes the family connection first (pg_database), then opens the
    // declared database and proves current_database() there.
    expect(argvs.length).toBe(2);
    expect(argvs[0]?.at(-1)).toBe('postgres');
    expect(stdins[0]).toContain('FROM pg_database');
    expect(argvs[1]?.at(-1)).toBe('agents');
    expect(stdins[1]).toContain('current_database()');
  });
});

describe('a missing declared database on reconcile is a typed refusal', () => {
  test('reconcile fails PostgresGrantsDatabaseMissing and never opens the declared database', async () => {
    const { run, stdins, argvs } = recording('[]', '[{"database":"agents"}]');
    const error = await Effect.runPromise(
      Effect.flip(
        grantsReconcile({
          ...handlerArgs,
          news: declared,
          olds: declared,
          output: undefined,
        }).pipe(Effect.provide(provide(run))),
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsDatabaseMissing);
    expect(error).toMatchObject({ database: 'agents' });
    // Only the family-connection probe ran; reconcile never opened the declared database.
    expect(stdins.length).toBe(1);
    expect(stdins[0]).toContain('FROM pg_database');
    expect(argvs[0]?.at(-1)).toBe('postgres');
  });
});
