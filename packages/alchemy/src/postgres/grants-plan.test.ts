/**
 * The pure diff engine: `resolveProps`' defaults, the declaration refusals, the repair plan
 * (no-op, drift, revoke-only, grant-option split, the two PUBLIC clears) and `splitGrantWords`.
 * The read-back projection, the plan-time comparison and the cleared twin `delete` replays
 * live in `grants-plan-diff.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import {
  declarationRefusal,
  grantsNamesRefusal,
  resolveProps,
  splitGrantWords,
} from './grants-declare.ts';
import { planRepair } from './grants-plan.ts';
import type { LiveGrants } from './grants-read.ts';

const props: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
};

const live = (over: Partial<LiveGrants> = {}): LiveGrants => ({
  schemaExists: true,
  schema: { role: [], public: [] },
  tables: [],
  columns: [],
  defaults: [],
  ...over,
});

describe('resolveProps', () => {
  test('schemaUsage defaults true, schemaCreate and the PUBLIC revokes default false', () => {
    const declared = resolveProps(props);
    expect(declared.schemaPrivileges).toEqual(['usage']);
    expect(declared.publicSchemaRevoked).toBe(false);
    expect(declared.publicTablesRevoked).toBe(false);
  });

  test('lists are deduplicated and sorted, both for stability and for positional equality', () => {
    const declared = resolveProps({
      ...props,
      tables: [
        { table: 'zeta', privileges: ['insert', 'select', 'select'] },
        { table: 'alpha', privileges: ['select'] },
      ],
      columnGrants: [{ table: 'zeta', column: 'b', privileges: ['select'] }],
    });
    expect(declared.tables.map((t) => [t.table, t.privileges])).toEqual([
      ['alpha', ['select']],
      ['zeta', ['insert', 'select']],
    ]);
    expect(declared.columns).toEqual([{ table: 'zeta', column: 'b', privileges: ['select'] }]);
  });
});

describe('declarationRefusal', () => {
  test('a table word outside the table vocabulary is refused with the prop naming the table', () => {
    const refusal = declarationRefusal(
      resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['execute'] }] }),
    );
    expect(refusal).toEqual({ kind: 'privilege', prop: 'tables.widgets', word: 'execute' });
  });

  test('a column word that is table-wide only (TRUNCATE) is refused', () => {
    const refusal = declarationRefusal(
      resolveProps({
        ...props,
        columnGrants: [{ table: 'widgets', column: 'id', privileges: ['truncate'] }],
      }),
    );
    expect(refusal).toEqual({
      kind: 'privilege',
      prop: 'columnGrants.widgets.id',
      word: 'truncate',
    });
  });

  test('a default-privileges word must be a table word, not a schema word', () => {
    const refusal = declarationRefusal(
      resolveProps({ ...props, defaultPrivileges: [{ forRole: 'owner', privileges: ['usage'] }] }),
    );
    expect(refusal).toEqual({ kind: 'privilege', prop: 'defaultPrivileges.owner', word: 'usage' });
  });

  test('a bare "*" is never a privilege', () => {
    const refusal = declarationRefusal(
      resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['*'] }] }),
    );
    expect(refusal).toEqual({ kind: 'privilege', prop: 'tables.widgets', word: '*' });
  });

  test('the same table, column pair or forRole twice is a duplicate refusal', () => {
    expect(
      declarationRefusal(
        resolveProps({
          ...props,
          tables: [
            { table: 'widgets', privileges: ['select'] },
            { table: 'widgets', privileges: ['insert'] },
          ],
        }),
      ),
    ).toEqual({ kind: 'duplicate', prop: 'tables', name: 'widgets' });
    expect(
      declarationRefusal(
        resolveProps({
          ...props,
          columnGrants: [
            { table: 'widgets', column: 'id', privileges: ['select'] },
            { table: 'widgets', column: 'id', privileges: ['insert'] },
          ],
        }),
      ),
    ).toEqual({ kind: 'duplicate', prop: 'columnGrants', name: 'widgets.id' });
    expect(
      declarationRefusal(
        resolveProps({
          ...props,
          defaultPrivileges: [
            { forRole: 'owner', privileges: ['select'] },
            { forRole: 'owner', privileges: ['insert'] },
          ],
        }),
      ),
    ).toEqual({ kind: 'duplicate', prop: 'defaultPrivileges', name: 'owner' });
  });

  test('grantsNamesRefusal flags the first over-long name, a 63-byte one passes', () => {
    const refused = grantsNamesRefusal(resolveProps({ ...props, role: 'a'.repeat(64) }));
    expect(refused).toEqual({ name: 'a'.repeat(64), byteLength: 64, limit: 63 });
    expect(grantsNamesRefusal(resolveProps({ ...props, schema: 'a'.repeat(63) }))).toBeUndefined();
  });
});

describe('planRepair', () => {
  test('a class whose live set equals the declaration contributes nothing', () => {
    expect(
      planRepair(
        resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['select'] }] }),
        live({
          schema: { role: ['usage'], public: [] },
          tables: [{ table: 'widgets', role: ['select'], public: [] }],
        }),
      ),
    ).toEqual([]);
  });

  test('drift on a table is REVOKE ALL then GRANT the declared words', () => {
    expect(
      planRepair(
        resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['select'] }] }),
        live({ tables: [{ table: 'widgets', role: ['insert', 'update'], public: [] }] }),
      ),
    ).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ON "app"."widgets" TO "seat_writer"',
    ]);
  });

  test('a class that declares nothing but holds live grants gets the revoke only', () => {
    expect(
      planRepair(
        resolveProps({ ...props, schemaUsage: false }),
        live({ schema: { role: ['usage'], public: [] } }),
      ),
    ).toEqual(['REVOKE ALL ON SCHEMA "app" FROM "seat_writer"']);
  });

  test('a mixed grant-option list splits into one plain grant and one option grant', () => {
    const plan = planRepair(
      resolveProps({
        ...props,
        tables: [{ table: 'widgets', privileges: ['select', 'insert*'] }],
      }),
      live({ tables: [{ table: 'widgets', role: ['delete'], public: [] }] }),
    );
    expect(plan).toContain('GRANT select ON "app"."widgets" TO "seat_writer"');
    expect(plan).toContain('GRANT insert ON "app"."widgets" TO "seat_writer" WITH GRANT OPTION');
    expect(plan.some((s) => s === 'GRANT select, insert ON "app"."widgets" TO "seat_writer"')).toBe(
      false,
    );
  });
});

describe('the PUBLIC clears', () => {
  const declared = resolveProps({ ...props, revokeFromPublic: true });

  test('PUBLIC schema words earn the schema revoke; PUBLIC table words earn the tables revoke', () => {
    expect(planRepair(declared, live({ schema: { role: ['usage'], public: ['usage'] } }))).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM PUBLIC',
    ]);
    expect(
      planRepair(
        declared,
        live({
          schema: { role: ['usage'], public: [] },
          columns: [{ table: 'widgets', column: 'id', role: [], public: ['select'] }],
        }),
      ),
    ).toEqual(['REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC']);
  });

  test('without the flag, PUBLIC holds are never drift', () => {
    expect(
      planRepair(resolveProps(props), live({ schema: { role: ['usage'], public: ['usage'] } })),
    ).toEqual([]);
  });
});

describe('splitGrantWords', () => {
  test('splits by the trailing mark, order preserved', () => {
    expect(splitGrantWords(['select', 'insert*', 'update'])).toEqual({
      plain: ['select', 'update'],
      grantable: ['insert*'],
    });
  });
});
