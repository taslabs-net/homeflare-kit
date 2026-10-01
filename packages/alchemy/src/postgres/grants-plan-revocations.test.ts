/**
 * `planRevocations`: the entries an update removed from the declaration. Extracted from
 * `grants-repair-plan.test.ts` so both files stay under the code-size cap.
 */
import { describe, expect, test } from 'bun:test';
import { planRevocations } from './grants-plan.ts';
import type { LiveGrants } from './grants-read.ts';

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

const removed = {
  schema: 'app',
  role: 'seat_writer',
  tables: [{ table: 'widgets', privileges: [] as ReadonlyArray<string> }],
  columns: [{ table: 'widgets', column: 'id', privileges: [] as ReadonlyArray<string> }],
  defaults: [{ forRole: 'owner_role', privileges: [] as ReadonlyArray<string> }],
};

describe('planRevocations (the entries an update removed)', () => {
  test('a removed object still showing the role\u2019s words earns exactly one revoke', () => {
    expect(
      planRevocations(
        removed,
        live({
          tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
          columns: [
            {
              table: 'widgets',
              column: 'id',
              role: ['select'],
              public: [],
              restorable: ['select'],
            },
          ],
          defaults: [{ forRole: 'owner_role', role: ['select'] }],
        }),
      ),
    ).toEqual([
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "seat_writer"',
    ]);
  });

  test('a removed object the catalogs show empty for (revoked, or dropped) emits nothing', () => {
    expect(planRevocations(removed, live())).toEqual([]);
  });

  test('a removed table the role OWNS emits nothing — the owner\u2019s implicit rights are not this resource\u2019s to revoke', () => {
    expect(
      planRevocations(
        removed,
        live({
          ownedTables: ['widgets'],
          tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
        }),
      ),
    ).toEqual([]);
  });
});
