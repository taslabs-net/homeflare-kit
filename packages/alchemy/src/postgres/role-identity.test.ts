/**
 * Oid identity, live membership options, and the unfinished-create resume. The engine passes
 * stored attributes to `diff` and calls `read` with `output: undefined` on a `creating` row;
 * these tests drive `postgresRoleHandlers` the way that engine does, over the runner transport.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import { Artifacts, makeScopedArtifacts } from 'alchemy/Artifacts';
import { InMemoryService } from 'alchemy/State/InMemoryState';
import { State } from 'alchemy/State/State';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import { unfinished } from '../ownership/resume.ts';
import { postgresRunnerConnection } from './connection.ts';
import { parseLiteral } from './fake-sql-quote.ts';
import { makeFakeSql } from './fake-sql.ts';
import { type PsqlRunner } from './psql-executor.ts';
import { PostgresRoleIdentityRefused } from './role-errors.ts';
import { postgresRoleHandlers } from './role-provider.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';

const baseProps: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const stored = (): PostgresRoleAttributes => ({
  name: 'seat-observability',
  oid: 20000,
  login: false,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: ['hf_agent'],
  passwordSeal: '',
});

/** Same envelope the adopt test uses: `withPg` wraps a SELECT in `json_agg` and inlines `$1`. */
const runnerFor =
  (fake: ReturnType<typeof makeFakeSql>): PsqlRunner =>
  async ({ stdin }) => {
    const wrapped = /^SELECT coalesce\(json_agg\(t\), '\[\]'::json\)::text FROM \((.*)\) t;$/s.exec(
      stdin,
    );
    const body = (wrapped?.[1] ?? stdin).replace(/;\s*$/, '');
    const bound = /^([\s\S]*) = (E'[\s\S]*')$/.exec(body);
    const sql = bound === null ? body : `${bound[1]} = $1`;
    const params = bound === null ? [] : [parseLiteral(bound[2] as string)];
    const rows = await Effect.runPromise(fake.unsafe(sql, params));
    return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
  };

const layerFor = (fake: ReturnType<typeof makeFakeSql>) =>
  postgresRunnerConnection({
    run: runnerFor(fake),
    database: 'postgres',
    username: 'postgres',
  });

const handlers = postgresRoleHandlers;
if (handlers.read === undefined || handlers.diff === undefined || handlers.delete === undefined) {
  throw new Error('Postgres.Role read, diff and delete are part of the provider');
}
const readRoleHandler = handlers.read;
const diffRoleHandler = handlers.diff;
const deleteRoleHandler = handlers.delete;

const ids = {
  id: 'seat-observability',
  fqn: 'Postgres.Role/seat-observability',
  instanceId: 'i',
};

describe('oid and live membership options', () => {
  test('a recycled oid is refused on read, diff and delete, and delete issues no DROP', async () => {
    const fake = makeFakeSql({ roleRows: [{ ...stored(), oid: 7 }] });
    const output = stored();
    const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provide(layerFor(fake)));
    const readError = await Effect.runPromise(
      Effect.flip(provided(readRoleHandler({ ...ids, olds: baseProps, output }))),
    );
    expect(readError).toBeInstanceOf(PostgresRoleIdentityRefused);
    const diffError = await Effect.runPromise(
      Effect.flip(
        provided(
          diffRoleHandler({
            ...ids,
            olds: baseProps,
            news: { ...baseProps, memberOf: ['hf_agent'] },
            output,
            oldBindings: [],
            newBindings: [],
          }),
        ),
      ),
    );
    expect(diffError).toBeInstanceOf(PostgresRoleIdentityRefused);
    await Effect.runPromise(
      Effect.flip(
        provided(
          deleteRoleHandler({
            ...ids,
            olds: baseProps,
            output,
            session: {} as never,
            bindings: [],
          }),
        ),
      ),
    );
    expect(fake.statements.some((s) => s.text.startsWith('DROP'))).toBe(false);
  });

  test('diff reads live ADMIN even though stored output has no membership rows', async () => {
    const fake = makeFakeSql({ roleRows: [stored()] });
    fake.memberships.add('seat-observability\0hf_agent\0postgres');
    fake.membershipOptions.set('seat-observability\0hf_agent\0postgres', {
      admin: true,
      set: false,
    });
    const plan = await Effect.runPromise(
      diffRoleHandler({
        ...ids,
        olds: baseProps,
        news: { ...baseProps, memberOf: ['hf_agent'] },
        output: stored(),
        oldBindings: [],
        newBindings: [],
      }).pipe(Effect.provide(layerFor(fake))),
    );
    expect(plan).toEqual({ action: 'update' });
  });

  test('a creating row with no attributes is noted unfinished', async () => {
    const bag = makeScopedArtifacts(new Map(), ids.fqn);
    const plan = await Effect.runPromise(
      diffRoleHandler({
        ...ids,
        instanceId: 'creating-1',
        olds: baseProps,
        news: baseProps,
        output: undefined,
        oldBindings: [],
        newBindings: [],
      }).pipe(Effect.provideService(Artifacts, bag), Effect.provide(layerFor(makeFakeSql()))),
    );
    expect(plan).toBeUndefined();
    expect(
      await Effect.runPromise(unfinished('creating-1').pipe(Effect.provideService(Artifacts, bag))),
    ).toBe(true);
  });

  test('a creating row whose live role matches the declaration is ours', async () => {
    const fake = makeFakeSql({ roleRows: [{ ...stored(), memberOf: [] }] });
    const row = {
      fqn: ids.fqn,
      instanceId: 'creating-1',
      status: 'creating',
      props: baseProps,
    };
    const found = await Effect.runPromise(
      readRoleHandler({
        ...ids,
        instanceId: 'creating-1',
        olds: baseProps,
        output: undefined,
      }).pipe(
        Effect.provide(layerFor(fake)),
        Effect.provideService(State, InMemoryService({ s: { test: { [ids.fqn]: row as never } } })),
        Effect.provideService(Stack, {
          actions: {},
          bindings: {},
          name: 's',
          resources: { [ids.fqn]: { Props: baseProps } },
          stage: 'test',
        } as never),
      ),
    );
    expect(Unowned.is(found)).toBe(false);
    expect(found?.oid).toBe(20000);
  });
});
