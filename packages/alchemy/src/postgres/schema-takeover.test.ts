/** Regressions for unresolved-Output apply paths, driven through the actual runner handlers. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { postgresSchemaHandlers, reconcileWithClient } from './schema.ts';
import { postgresRunnerConnection } from './connection.ts';
import { makeFakeSql } from './fake-sql.ts';
import { readArgs, router, runnerWith } from './schema-test-kit.ts';
import type { PostgresSchemaAttributes } from './schema-attrs.ts';

const props = { name: 'ledger', database: 'postgres', owner: 'postgres', cascade: true };
const stored: PostgresSchemaAttributes = { ...props, oid: 25533, comment: null };
const replacement = { ...stored, oid: 25534 };
const args = (output?: PostgresSchemaAttributes) => ({
  ...readArgs(props),
  news: props,
  output,
  session: undefined as never,
});

for (const name of ['ledger', 'public']) {
  test(`apply refuses existing ${name} without output even when owner matches`, async () => {
    const { run, stdins } = runnerWith(
      router({ proof: '[{"database":"postgres"}]', schema: JSON.stringify([{ ...stored, name }]) }),
    );
    const error = await Effect.runPromise(
      postgresSchemaHandlers
        .reconcile({ ...args(), news: { ...props, name } })
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
          Effect.flip,
        ),
    );
    expect(error).toMatchObject({ _tag: 'PostgresSchemaExistsRefused' });
    expect(stdins.every((s) => s.startsWith('SELECT'))).toBe(true);
  });
}

test('update refuses a recycled oid before it can replace the delete proof', async () => {
  const fake = makeFakeSql({ schemas: [replacement], schemasWithRelations: ['ledger'] });
  const error = await Effect.runPromise(Effect.flip(reconcileWithClient(fake, props, stored)));
  expect(error).toMatchObject({
    _tag: 'PostgresSchemaIdentityRefused',
    storedOid: 25533,
    liveOid: 25534,
  });
  expect(fake.schemas.get('ledger')).toEqual(replacement);
  expect(fake.relationsIn.has('ledger')).toBe(true);
});

test('read refuses a recycled oid instead of refreshing persisted proof', async () => {
  const { run } = runnerWith(
    router({ probe: '[{"present":1}]', schema: JSON.stringify([replacement]) }),
  );
  const read = postgresSchemaHandlers.read;
  if (read === undefined) throw new Error('missing read');
  const error = await Effect.runPromise(
    read({ ...readArgs(props), output: stored }).pipe(
      Effect.provide(postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' })),
      Effect.flip,
    ),
  );
  expect(error).toMatchObject({ _tag: 'PostgresSchemaIdentityRefused' });
});

for (const [change, tag] of [
  [{ name: 'new_ledger' }, 'PostgresSchemaRenameRefused'],
  [{ database: 'new_database' }, 'PostgresSchemaDatabaseRefused'],
] as const) {
  test(`apply repeats ${tag} after unresolved diff`, async () => {
    const { run, stdins } = runnerWith(
      router({
        proof: JSON.stringify([{ database: change.database ?? 'postgres' }]),
        schema: JSON.stringify([{ ...stored, ...change }]),
      }),
    );
    const error = await Effect.runPromise(
      postgresSchemaHandlers
        .reconcile({ ...args(stored), news: { ...props, ...change } })
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
          Effect.flip,
        ),
    );
    expect(error).toMatchObject({ _tag: tag });
    expect(stdins).toEqual([]);
  });
}

test('same-owner create race is a typed exists refusal, never a comment or adoption', async () => {
  const fake = makeFakeSql({ roles: ['postgres'], raceNextCreateSchema: 'postgres' });
  const error = await Effect.runPromise(
    Effect.flip(reconcileWithClient(fake, { ...props, comment: 'ours' })),
  );
  expect(error).toMatchObject({ _tag: 'PostgresSchemaExistsRefused' });
  expect(fake.schemas.get('ledger')?.comment).toBeNull();
});

test('runner 42P06 becomes an adoption refusal; other SQLSTATEs remain SqlError', async () => {
  for (const code of ['42P06', '42501']) {
    const run = ({ stdin }: { stdin: string }) =>
      Promise.resolve(
        stdin.startsWith('CREATE')
          ? { code: 3, stdout: '', stderr: `ERROR:  ${code}: refused` }
          : {
              code: 0,
              stdout:
                stdin.includes('current_database()') && !stdin.includes('pg_namespace')
                  ? '[{"database":"postgres"}]'
                  : stdin.includes('pg_roles')
                    ? '[{"present":1}]'
                    : '[]',
              stderr: '',
            },
      );
    const error = await Effect.runPromise(
      postgresSchemaHandlers
        .reconcile(args())
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
          Effect.flip,
        ),
    );
    expect(error._tag).toBe(code === '42P06' ? 'PostgresSchemaExistsRefused' : 'SqlError');
  }
});

// Apply.ts passes the adopted live attributes as output. The stricter gate must permit that.
test('explicit adoption output permits a matching schema with zero writes', async () => {
  const { run, stdins } = runnerWith(
    router({ proof: '[{"database":"postgres"}]', schema: JSON.stringify([stored]) }),
  );
  const result = await Effect.runPromise(
    postgresSchemaHandlers
      .reconcile(args(stored))
      .pipe(
        Effect.provide(
          postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
        ),
      ),
  );
  expect(result).toEqual(stored);
  expect(stdins.every((s) => s.startsWith('SELECT'))).toBe(true);
});
