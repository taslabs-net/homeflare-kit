/**
 * The real `Postgres.Schema` lifecycle handlers, driven directly over the loopback runner
 * transport — no live database, the same wiring `psql-executor.test.ts` uses: the delete path
 * (drop, non-empty refusal, wrong-database proof, the retain default) and `read`'s `Unowned`
 * adopt branding. Plan-time refusals live in `schema-refusals.test.ts`; the fake-driven
 * create/adopt/drop lifecycle in `schema-lifecycle.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import { postgresRunnerConnection } from './connection.ts';
import { type PsqlRunner } from './psql-executor.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { Unowned } from 'alchemy/AdoptPolicy';
import { postgresSchemaHandlers } from './schema.ts';
import { PostgresSchemaDropNotEmptyError, PostgresSchemaWrongDatabase } from './schema-errors.ts';

const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });

const sampleOutput: PostgresSchemaAttributes = {
  name: 'ledger',
  database: 'postgres',
  oid: 1,
  owner: 'tim',
  comment: null,
};
const base: PostgresSchemaProps = { name: 'ledger', database: 'postgres', owner: 'tim' };

/** The handler inputs the engine passes. `output` is required on `delete` (the persisted state
 * is what delete drops) and optional on `read` (undefined is the adopt path). */
const deleteArgs = (olds: PostgresSchemaProps, output: PostgresSchemaAttributes) => ({
  id: 'x',
  fqn: 'x',
  instanceId: 'x',
  olds,
  output,
  session: undefined as never,
  bindings: [] as never,
});
const readArgs = (olds: PostgresSchemaProps) => ({
  id: 'x',
  fqn: 'x',
  instanceId: 'x',
  olds,
  output: undefined,
  session: undefined as never,
  bindings: [] as never,
});

// `read` is optional on the service type; these tests drive the real one.
if (postgresSchemaHandlers.read === undefined) {
  throw new Error('Postgres.Schema is missing its read handler');
}
const schemaRead = postgresSchemaHandlers.read;

/** A recording `PsqlRunner`: every stdin is kept, each answered by `answers`. */
const runnerWith = (answers: (stdin: string) => string): { run: PsqlRunner; stdins: string[] } => {
  const stdins: string[] = [];
  return {
    run: ({ stdin }) => {
      stdins.push(stdin);
      return Promise.resolve({ code: 0, stdout: answers(stdin), stderr: '' });
    },
    stdins,
  };
};
const proof = '[{"database":"postgres"}]';

describe('delete handler (runner transport)', () => {
  test('the real handler drops an empty schema over the runner transport, no CASCADE', async () => {
    const { run, stdins } = runnerWith((stdin) =>
      stdin.includes('current_database()')
        ? proof
        : stdin.includes('AS empty')
          ? '[{"empty":true}]'
          : '',
    );
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs({ ...base, cascade: true }, sampleOutput))
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.find((s) => s.startsWith('SELECT coalesce(json_agg'))).toContain(
      'SELECT current_database()',
    );
    expect(stdins.find((s) => s.startsWith('DROP SCHEMA'))).toBe(
      'DROP SCHEMA IF EXISTS "ledger" CASCADE;',
    );
  });

  test('the real handler refuses a non-empty schema over the runner transport, no DROP issued', async () => {
    const { run, stdins } = runnerWith((stdin) =>
      stdin.includes('current_database()')
        ? proof
        : stdin.includes('AS empty')
          ? '[{"empty":false}]'
          : '',
    );
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete(deleteArgs(base, sampleOutput))
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
    expect(stdins.some((s) => s.startsWith('DROP SCHEMA'))).toBe(false);
  });

  test('the real handler refuses a wrong connected database before any DROP', async () => {
    // The connection targets `postgres` while the declaration says `agents` — the proof must
    // fail the delete before anything is dropped.
    const { run, stdins } = runnerWith((stdin) =>
      stdin.includes('current_database()') ? proof : '',
    );
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete(
            deleteArgs({ ...base, database: 'agents' }, { ...sampleOutput, database: 'agents' }),
          )
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaWrongDatabase);
    expect(stdins.some((s) => s.startsWith('DROP SCHEMA'))).toBe(false);
  });

  test('defaultRemovalPolicy is retain — declared on the Resource for Postgres.Schema itself', () => {
    // The engine keeps the default in a closure, not on the constructor, so the source IS the
    // assertable fact — anchored to this resource's own declaration, not any string in the file.
    const source = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8');
    expect(source).toMatch(
      /Resource<PostgresSchema>\('Postgres\.Schema', \{\s*\n\s*defaultRemovalPolicy: 'retain',/,
    );
  });
});

describe('read handler (runner transport)', () => {
  test('answers Unowned for a live row — the adopt-path branding a stack needs', async () => {
    const run: PsqlRunner = ({ stdin }) => {
      // The schema SELECT also projects `current_database() AS database`, so the row query is
      // identified by `FROM pg_namespace` and the bare proof by its absence.
      if (stdin.includes('FROM pg_namespace')) {
        // `oid` crosses the runner as a JSON string; the executor normalizes it to a number.
        return ok(
          '[{"name":"ledger","oid":"16384","owner":"tim","comment":null,"database":"postgres"}]',
        );
      }
      if (stdin.includes('current_database()')) return ok(proof);
      return ok('');
    };
    const result = await Effect.runPromise(
      schemaRead(readArgs(base)).pipe(
        Effect.provide(
          postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
        ),
      ),
    );
    expect(Unowned.is(result)).toBe(true);
    // The brand is a non-enumerable symbol that bun's toEqual compares; spread it off.
    expect({ ...result }).toEqual({ ...sampleOutput, oid: 16384 });
  });

  test('refuses with the typed wrong-database tag when the row was read from another database', async () => {
    const run: PsqlRunner = ({ stdin }) =>
      Promise.resolve({
        code: 0,
        stdout: stdin.includes('current_database()')
          ? '[{"database":"agents"}]'
          : '[{"name":"ledger","oid":"16384","owner":"tim","comment":null,"database":"agents"}]',
        stderr: '',
      });
    const error = await Effect.runPromise(
      Effect.flip(
        schemaRead(readArgs(base)).pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaWrongDatabase);
    expect((error as PostgresSchemaWrongDatabase).connected).toBe('agents');
  });
});
