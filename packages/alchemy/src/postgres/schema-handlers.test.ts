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
import type { PsqlRunner } from './psql-executor.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { Unowned } from 'alchemy/AdoptPolicy';
import { postgresSchemaHandlers } from './schema.ts';
import { PostgresSchemaDropNotEmptyError, PostgresSchemaWrongDatabase } from './schema-errors.ts';
import { deleteArgs, ok, readArgs, route, router, runnerWith } from './schema-test-kit.ts';

const sampleOutput: PostgresSchemaAttributes = {
  name: 'ledger',
  database: 'postgres',
  oid: 1,
  owner: 'tim',
  comment: null,
};
const base: PostgresSchemaProps = { name: 'ledger', database: 'postgres', owner: 'tim' };

// `read` is optional on the service type; these tests drive the real one.
if (postgresSchemaHandlers.read === undefined) {
  throw new Error('Postgres.Schema is missing its read handler');
}
const schemaRead = postgresSchemaHandlers.read;
const proof = '[{"database":"postgres"}]';

describe('delete handler (runner transport)', () => {
  test('the real handler drops an empty schema over the runner transport, with CASCADE', async () => {
    const { run, stdins, argvs } = runnerWith(
      router({
        probe: '[{"present":1}]',
        schema: '[{"name":"ledger","oid":1,"owner":"tim"}]',
        empty: '[{"empty":true}]',
        proof,
      }),
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
    expect(stdins.find((s) => s.startsWith('DROP SCHEMA'))).toBe(
      'DROP SCHEMA IF EXISTS "ledger" CASCADE;',
    );
    // One `psql` argv per STATEMENT: probe, proof, ownership re-read, drop. The probe's argv
    // targets the family database; the delete's argvs target the declared one — the `-d` value
    // is the argv's last element.
    expect(argvs.length).toBe(4);
    expect(argvs[0]?.at(-1)).toBe('postgres');
    expect(argvs.slice(1).every((argv) => argv.at(-1) === 'postgres')).toBe(true);
  });

  test('the real handler drops an empty schema without CASCADE — a plain DROP', async () => {
    const { run, stdins } = runnerWith(
      router({
        probe: '[{"present":1}]',
        schema: '[{"name":"ledger","oid":1,"owner":"tim"}]',
        empty: '[{"empty":true}]',
        proof,
      }),
    );
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs(base, sampleOutput))
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.find((s) => s.startsWith('DROP SCHEMA'))).toBe('DROP SCHEMA IF EXISTS "ledger";');
  });

  test('the real handler refuses a non-empty schema over the runner transport, no DROP issued', async () => {
    const { run, stdins } = runnerWith(
      router({
        probe: '[{"present":1}]',
        schema: '[{"name":"ledger","oid":1,"owner":"tim"}]',
        empty: '[{"empty":false}]',
        proof,
      }),
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
    // fail the delete before anything is dropped. The database probe answers PRESENT, so the
    // absent-database short-circuit does not swallow the wrong-database refusal.
    const { run, stdins } = runnerWith(
      router({ probe: '[{"present":1}]', proof: '[{"database":"postgres"}]' }),
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
      const r = route(stdin, {
        probe: '[{"present":1}]',
        schema:
          '[{"name":"ledger","oid":"16384","owner":"tim","comment":null,"database":"postgres"}]',
        proof,
      });
      if (r !== undefined) return ok(r);
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
        stdout:
          route(stdin, {
            probe: '[{"present":1}]',
            schema:
              '[{"name":"ledger","oid":"16384","owner":"tim","comment":null,"database":"agents"}]',
            proof: '[{"database":"agents"}]',
          }) ?? '',
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
