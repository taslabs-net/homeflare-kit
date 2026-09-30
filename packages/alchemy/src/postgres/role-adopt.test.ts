/**
 * Apply-time ownership for `Postgres.Role`. The review of PR 336: `read` answers `Unowned` when
 * the stack holds no state, but `reconcile` never called `refuseTakeover`, so a live role found
 * between plan and apply (or one Alchemy skipped probing because a prop was still an Output) was
 * altered and then recorded as ours.
 *
 * These tests construct `postgresRoleHandlers` — the lifecycle tests drive `reconcileWithClient`
 * directly and cannot see this hole. The recording fake is reached the way the engine reaches a
 * real cluster: `withPg` over the runner transport.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { postgresRunnerConnection } from './connection.ts';
import { makeFakeSql } from './fake-sql.ts';
import { type PsqlRunner } from './psql-executor.ts';
import { postgresRoleHandlers } from './role-provider.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';

const baseProps: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const liveRole = (): PostgresRoleAttributes => ({
  name: 'seat-observability',
  oid: 20000,
  login: true,
  connectionLimit: -1,
  inherit: false,
  validUntil: null,
  memberOf: ['hf_agent'],
  passwordSeal: '',
});

/**
 * A runner that answers the handler's `psql` calls from the recording fake. `withPg` wraps a
 * `SELECT` in `json_agg` and the executor inlines `$1` before the runner sees it, so this
 * unwraps that envelope and binds the literal back to the param the fake's catalog read expects.
 */
const runnerFor =
  (fake: ReturnType<typeof makeFakeSql>): PsqlRunner =>
  async ({ stdin }) => {
    const wrapped = /^SELECT coalesce\(json_agg\(t\), '\[\]'::json\)::text FROM \((.*)\) t;$/s.exec(
      stdin,
    );
    const body = (wrapped?.[1] ?? stdin).replace(/;\s*$/, '');
    const bound = /^([\s\S]*) = '((?:[^']|'')*)'$/.exec(body);
    const sql = bound === null ? body : `${bound[1]} = $1`;
    const params = bound === null ? [] : [bound[2]?.replace(/''/g, "'")];
    const rows = await Effect.runPromise(fake.unsafe(sql, params));
    return { code: 0, stdout: JSON.stringify(rows), stderr: '' };
  };

const writes = (fake: ReturnType<typeof makeFakeSql>) =>
  fake.statements.filter(
    (s) =>
      s.text.startsWith('ALTER') ||
      s.text.startsWith('GRANT') ||
      s.text.startsWith('REVOKE') ||
      s.text.startsWith('CREATE'),
  );

describe('adopt-off takeover', () => {
  test('a live role and adopt-off produces no statement', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    fake.memberships.add('seat-observability\0hf_agent');
    const refused = await Effect.runPromise(
      postgresRoleHandlers
        .reconcile({
          id: 'seat-observability',
          fqn: 'Postgres.Role/seat-observability',
          instanceId: 'creating-1',
          news: baseProps,
          output: undefined,
          olds: baseProps,
          session: {} as never,
          bindings: [],
        })
        .pipe(
          Effect.provide(
            postgresRunnerConnection({
              run: runnerFor(fake),
              database: 'postgres',
              username: 'postgres',
            }),
          ),
          Effect.exit,
        ),
    );
    // refuseTakeover dies: a takeover is a defect, not a typed error the engine retries.
    const rendered = refused._tag === 'Failure' ? String(refused.cause) : JSON.stringify(refused);
    expect(rendered).toContain('already exists');
    expect(writes(fake)).toEqual([]);
  });
});
