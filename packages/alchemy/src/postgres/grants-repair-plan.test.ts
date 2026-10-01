/**
 * The pure statement planners: `planRepair`'s per-class repair (no-op, drift, the
 * revoke-only delete twin, the grant-option split, the two PUBLIC clears), the measured
 * rules the convergence proof depends on (a table revoke clears its declared columns;
 * owned objects are left alone). Removal revokes live in `grants-plan-revocations.test.ts`.
 * `resolveProps` and the refusals live in `grants-plan.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import { resolveProps } from './grants-declare.ts';
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
  schemaOwnedByRole: false,
  ownedTables: [],
  ...over,
});

describe('planRepair', () => {
  test('a class whose live set equals the declaration contributes nothing', () => {
    expect(
      planRepair(
        resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['select'] }] }),
        live({
          schema: { role: ['usage'], public: [] },
          tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
        }),
      ),
    ).toEqual([]);
  });

  test('drift on a table is REVOKE ALL then GRANT the declared words', () => {
    expect(
      planRepair(
        resolveProps({ ...props, tables: [{ table: 'widgets', privileges: ['select'] }] }),
        live({
          tables: [{ table: 'widgets', relkind: 'r', role: ['insert', 'update'], public: [] }],
        }),
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
      live({ tables: [{ table: 'widgets', relkind: 'r', role: ['delete'], public: [] }] }),
    );
    expect(plan).toContain('GRANT select ON "app"."widgets" TO "seat_writer"');
    expect(plan).toContain('GRANT insert ON "app"."widgets" TO "seat_writer" WITH GRANT OPTION');
    expect(plan.some((s) => s === 'GRANT select, insert ON "app"."widgets" TO "seat_writer"')).toBe(
      false,
    );
  });

  test('a table revoke also re-grants the table\u2019s declared columns in the SAME pass — measured on PG 18.6, a table REVOKE ALL clears that grantee\u2019s column entries', () => {
    const plan = planRepair(
      resolveProps({
        ...props,
        tables: [{ table: 'widgets', privileges: ['select', 'insert'] }],
        columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }],
      }),
      live({
        schema: { role: ['usage'], public: [] },
        tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
        columns: [
          { table: 'widgets', column: 'id', role: ['select'], public: [], restorable: ['select'] },
        ],
      }),
    );
    expect(plan).toEqual([
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT insert, select ON "app"."widgets" TO "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ("id") ON "app"."widgets" TO "seat_writer"',
    ]);
  });

  test('drift on a default-privileges entry is the ALTER DEFAULT PRIVILEGES revoke-then-grant pair', () => {
    expect(
      planRepair(
        resolveProps({
          ...props,
          defaultPrivileges: [{ forRole: 'owner_role', privileges: ['select'] }],
        }),
        live({
          schema: { role: ['usage'], public: [] },
          defaults: [{ forRole: 'owner_role', role: ['insert'] }],
        }),
      ),
    ).toEqual([
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "seat_writer"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" GRANT select ON TABLES TO "seat_writer"',
    ]);
  });

  test('objects the declared role OWNS contribute nothing — an owner holds every privilege implicitly and a revoke cannot take it away', () => {
    expect(
      planRepair(
        resolveProps({
          ...props,
          tables: [{ table: 'notes', privileges: ['select', 'insert'] }],
        }),
        live({
          schemaOwnedByRole: true,
          ownedTables: ['notes'],
          tables: [{ table: 'notes', relkind: 'r', role: [], public: [] }],
        }),
      ),
    ).toEqual([]);
  });

  test('ownership is per object: a table the role does NOT own is still repaired beside the owned one', () => {
    const plan = planRepair(
      resolveProps({
        ...props,
        tables: [
          { table: 'notes', privileges: ['select'] },
          { table: 'shared', privileges: ['select'] },
        ],
      }),
      live({
        ownedTables: ['notes'],
        tables: [
          { table: 'notes', relkind: 'r', role: [], public: [] },
          { table: 'shared', relkind: 'r', role: ['delete'], public: [] },
        ],
      }),
    );
    expect(plan.some((s) => s.includes('"notes"'))).toBe(false);
    expect(plan).toContain('REVOKE ALL ON "app"."shared" FROM "seat_writer"');
    expect(plan).toContain('GRANT select ON "app"."shared" TO "seat_writer"');
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
          columns: [
            { table: 'widgets', column: 'id', role: [], public: ['select'], restorable: [] },
          ],
        }),
      ),
    ).toEqual(['REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC']);
  });

  test('a PUBLIC grant on a SEQUENCE is outside the bulk revoke\u2019s reach (relkind S) and never blocks convergence', () => {
    expect(
      planRepair(
        declared,
        live({
          schema: { role: ['usage'], public: [] },
          tables: [{ table: 'app_seq', relkind: 'S', role: [], public: ['usage'] }],
        }),
      ),
    ).toEqual([]);
  });

  test('without the flag, PUBLIC holds are never drift', () => {
    expect(
      planRepair(resolveProps(props), live({ schema: { role: ['usage'], public: ['usage'] } })),
    ).toEqual([]);
  });
});
