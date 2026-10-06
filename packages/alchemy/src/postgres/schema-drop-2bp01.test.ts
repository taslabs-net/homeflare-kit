/**
 * SQLSTATE `2BP01` (`dependent_objects_still_exist`) must become
 * `PostgresSchemaDropNotEmptyError` on both transports.
 *
 * Measured at `@effect/sql-pg@4.0.0-rc.115` `src/internal/sqlError.ts#classifySqlState`:
 * only class `42` becomes `SqlSyntaxError`. `2BP01` is class `2B`, so the socket client
 * wraps it as `UnknownError` with the raw code on `reason.cause.code`
 * (`PgConnection.ts#classifyFields`). The runner transport copies that rule
 * (`psql-executor.ts#failure`). A test that builds `SqlSyntaxError` by hand pins a shape
 * neither driver produces.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { classifyInstalled } from './installed-classifier.ts';
import { postgresRunnerConnection } from './connection.ts';
import { type PsqlRunner, makePsqlExecutor } from './psql-executor.ts';
import { isDependentObjectsError } from './schema-sql.ts';
import { stripPin } from './search-path.ts';
import { PostgresSchemaDropNotEmptyError } from './schema-errors.ts';
import { dropWithClient, postgresSchemaHandlers } from './schema.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';

const baseProps: PostgresSchemaProps = { name: 'ledger', database: 'postgres', owner: 'tim' };

const socket2bp01 = (): Promise<SqlError> => classifyInstalled('2BP01');

/** The live row is ours; the atomic `DO` drop is the server's real `2BP01`. */
const emptyThenRefuse = (drop: Effect.Effect<ReadonlyArray<object>, SqlError>): PgExecutor => ({
  unsafe: <A extends object>(text: string) => {
    if (text.startsWith('DO ')) return drop as Effect.Effect<ReadonlyArray<A>, SqlError>;
    if (text.includes('FROM pg_catalog.pg_namespace')) {
      return Effect.succeed([
        { name: 'ledger', oid: 1, owner: 'tim', comment: null, database: 'postgres' },
      ] as unknown as ReadonlyArray<A>);
    }
    return Effect.succeed([{ database: 'postgres' }] as unknown as ReadonlyArray<A>);
  },
  transaction: () => Effect.void,
});

describe('2BP01 classification', () => {
  test('the installed socket classifier wraps 2BP01 as UnknownError, not SqlSyntaxError', async () => {
    const error = await socket2bp01();
    expect(error.reason._tag).toBe('UnknownError');
    expect(isDependentObjectsError(error)).toBe(true);
  });

  test('dropWithClient classifies the socket 2BP01 shape as the typed not-empty tag', async () => {
    const error = await Effect.runPromise(
      Effect.flip(dropWithClient(emptyThenRefuse(Effect.fail(await socket2bp01())), baseProps)),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
  });

  test('the runner transport classifies a verbose 2BP01 line as the typed not-empty tag', async () => {
    const run: PsqlRunner = ({ stdin: raw }) => {
      const stdin = stripPin(raw);
      if (!stdin.startsWith('DO ') && stdin.includes('FROM pg_catalog.pg_namespace')) {
        return Promise.resolve({
          code: 0,
          stdout:
            '[{"name":"ledger","oid":"1","owner":"tim","comment":null,"database":"postgres"}]',
          stderr: '',
        });
      }
      if (!stdin.startsWith('DO ') && stdin.includes('current_database()')) {
        return Promise.resolve({ code: 0, stdout: '[{"database":"postgres"}]', stderr: '' });
      }
      return Promise.resolve({
        code: 3,
        stdout: '',
        stderr: 'ERROR:  2BP01: dependent objects still exist\n',
      });
    };
    const produced = await Effect.runPromise(
      Effect.flip(
        makePsqlExecutor(run, { database: 'postgres', username: 'postgres' }).unsafe(
          'DROP SCHEMA IF EXISTS "ledger"',
        ),
      ),
    );
    expect(produced.reason._tag).toBe('UnknownError');
    expect(isDependentObjectsError(produced)).toBe(true);

    const error = await Effect.runPromise(
      Effect.flip(
        dropWithClient(
          makePsqlExecutor(run, { database: 'postgres', username: 'postgres' }),
          baseProps,
        ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
  });

  test('the real delete handler classifies a runner 2BP01 as the typed not-empty tag', async () => {
    // Order is load-bearing (schema-handlers.test.ts#route): the probe must answer PRESENT so
    // the absent-database short-circuit does not swallow the test, and the ownership re-read
    // must answer the row the persisted output vouches for, so the delete reaches the DROP.
    const run: PsqlRunner = ({ stdin: raw }) => {
      const stdin = stripPin(raw);
      if (stdin.startsWith('DO ')) {
        return Promise.resolve({
          code: 3,
          stdout: '',
          stderr: 'ERROR:  2BP01: dependent objects still exist\n',
        });
      }
      if (stdin.includes('FROM pg_catalog.pg_namespace')) {
        return Promise.resolve({
          code: 0,
          stdout: '[{"name":"ledger","oid":1,"owner":"tim"}]',
          stderr: '',
        });
      }
      if (stdin.includes('FROM pg_catalog.pg_database')) {
        return Promise.resolve({ code: 0, stdout: '[{"present":1}]', stderr: '' });
      }
      if (stdin.includes('current_database()')) {
        return Promise.resolve({ code: 0, stdout: '[{"database":"postgres"}]', stderr: '' });
      }
      return Promise.resolve({
        code: 3,
        stdout: '',
        stderr: 'ERROR:  2BP01: dependent objects still exist\n',
      });
    };
    const output: PostgresSchemaAttributes = {
      name: 'ledger',
      database: 'postgres',
      oid: 1,
      owner: 'tim',
      comment: null,
    };
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete({
            id: 'x',
            fqn: 'x',
            instanceId: 'x',
            olds: baseProps,
            output,
            session: undefined as never,
            bindings: [] as never,
          })
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDropNotEmptyError);
  });
});
