/**
 * The grants lifecycle over `makePsqlExecutor`, whose parameter rule the in-memory fake
 * does not share: only strings are inlined (`psql-executor.ts`). An existence check that
 * binds a JS array fails here with "param $2 must be a string" on every reconcile that
 * names a table or column — the transport CT100 actually uses.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PsqlRunner } from './psql-executor.ts';
import { makePsqlExecutor } from './psql-executor.ts';
import { stripPin } from './search-path.ts';
import { reconcileWithClient } from './grants-ops.ts';
import { requireDeclaredObjectsExist } from './grants-existence.ts';
import { resolveProps } from './grants-declare.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';

const props: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  tables: [{ table: 'a.b', privileges: ['select'] }],
  columnGrants: [{ table: 'a.b', column: 'c', privileges: ['select'] }],
};

/** Answers by SQL text. `granted` flips when the repair's `BEGIN` script is seen, so the
 * convergence re-read reports the privileges that script would have written. */
const runner = (): { run: PsqlRunner; stdins: string[] } => {
  const stdins: string[] = [];
  let granted = false;
  const run: PsqlRunner = ({ stdin: raw }) => {
    const stdin = stripPin(raw);
    stdins.push(stdin);
    if (stdin.startsWith('BEGIN')) granted = true;
    return Promise.resolve({ code: 0, stdout: answer(stdin, granted), stderr: '' });
  };
  return { run, stdins };
};

const answer = (stdin: string, granted: boolean): string => {
  if (stdin.includes('current_database()')) return '[{"database":"agents"}]';
  if (stdin.includes('json_array_elements_text')) return '[{"table":"a"},{"table":"a.b"}]';
  if (stdin.includes('json_array_elements')) {
    return '[{"table":"a","column":"b.c"},{"table":"a.b","column":"c"}]';
  }
  if (stdin.includes('SELECT 1 AS present FROM pg_catalog.pg_roles')) return '[{"present":1}]';
  if (stdin.includes('SELECT 1 AS present FROM pg_catalog.pg_namespace')) {
    return '[{"present":1}]';
  }
  if (stdin.includes('aclexplode(n.nspacl)')) {
    return granted ? '[{"public":false,"privilege":"usage","grantable":false}]' : '[]';
  }
  if (stdin.includes('aclexplode(c.relacl)')) {
    return granted
      ? '[{"table":"a.b","relkind":"r","public":false,"privilege":"select","grantable":false}]'
      : '[]';
  }
  if (stdin.includes('aclexplode(v.attacl)')) {
    return granted
      ? '[{"table":"a.b","column":"c","public":false,"privilege":"select","grantable":false,"grantor":"postgres","owner":"postgres","revoker":"postgres"}]'
      : '[]';
  }
  if (stdin.includes('aclexplode(d.defaclacl)')) return '[]';
  if (stdin.includes('nspowner')) return '[{"role_owns":false}]';
  if (stdin.includes('relowner')) return '[]';
  return '';
};

describe('grants lifecycle over the psql executor', () => {
  test('existence parameters are one JSON string, and the repair is one BEGIN script', async () => {
    const { run, stdins } = runner();
    const pg = makePsqlExecutor(run, { database: 'agents', username: 'postgres' });
    const attrs = await Effect.runPromise(reconcileWithClient(pg, props, undefined));
    expect(attrs.tables).toEqual([{ table: 'a.b', privileges: ['select'] }]);
    expect(attrs.columns).toEqual([{ table: 'a.b', column: 'c', privileges: ['select'] }]);
    const existence = stdins.filter((stdin) => stdin.includes('json_array_elements'));
    expect(existence.length).toBeGreaterThan(0);
    // Pairs, not a concatenated `a.b.c`: table `a.b` + column `c` stays two JSON elements.
    expect(existence.some((stdin) => stdin.includes('["a.b","c"]'))).toBe(true);
    expect(existence.some((stdin) => stdin.includes('||'))).toBe(false);
    const script = stdins.find((stdin) => stdin.startsWith('BEGIN'));
    expect(script).toContain('COMMIT');
    expect(script).toContain('REVOKE ALL ON "app"."a.b" FROM "seat_writer"');
    expect(script).toContain('GRANT select ("c") ON "app"."a.b" TO "seat_writer"');
  });

  test('a dotted table and a dotted column are separate JSON pairs', async () => {
    const { run, stdins } = runner();
    const pg = makePsqlExecutor(run, { database: 'agents', username: 'postgres' });
    await Effect.runPromise(
      requireDeclaredObjectsExist(
        pg,
        resolveProps({
          ...props,
          tables: [
            { table: 'a.b', privileges: ['select'] },
            { table: 'a', privileges: ['select'] },
          ],
          columnGrants: [
            { table: 'a.b', column: 'c', privileges: ['select'] },
            { table: 'a', column: 'b.c', privileges: ['select'] },
          ],
        }),
      ),
    );
    const columns = stdins.find((stdin) => stdin.includes('x->>1'));
    expect(columns).toContain('["a.b","c"]');
    expect(columns).toContain('["a","b.c"]');
  });
});
