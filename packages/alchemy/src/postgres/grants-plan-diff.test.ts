/**
 * The read-back projection (`attributesOf`), the plan-time comparison (`grantsDiffer`) and
 * the cleared twin `delete` replays (`clearedDeclaration`). The declaration refusals and the
 * repair plan itself live in `grants-plan.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import { clearedDeclaration, resolveProps } from './grants-declare.ts';
import { attributesOf, grantsDiffer, planRepair } from './grants-plan.ts';
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

describe('attributesOf and grantsDiffer', () => {
  const declared = resolveProps({
    ...props,
    tables: [{ table: 'widgets', privileges: ['select'] }],
  });
  const fresh = live({
    schema: { role: ['usage'], public: [] },
    tables: [{ table: 'widgets', role: ['select'], public: [] }],
  });

  test('attributes record the role words on the named objects and the PUBLIC facts', () => {
    const attrs = attributesOf(fresh, {
      role: 'seat_writer',
      database: 'agents',
      schema: 'app',
      tables: ['widgets'],
      columns: [],
      defaults: [],
    });
    expect(attrs.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(attrs.publicSchemaRevoked).toBe(true);
    expect(attrs.publicTablesRevoked).toBe(true);
  });

  test('equal declarations answer noop; a word, a name-set change and identity answer update', () => {
    const attrs = attributesOf(fresh, {
      role: 'seat_writer',
      database: 'agents',
      schema: 'app',
      tables: ['widgets'],
      columns: [],
      defaults: [],
    });
    expect(grantsDiffer(declared, attrs)).toBe(false);
    expect(grantsDiffer({ ...declared, schemaPrivileges: [] }, attrs)).toBe(true);
    expect(grantsDiffer({ ...declared, role: 'other' }, attrs)).toBe(true);
    const growing = resolveProps({
      ...props,
      tables: [
        { table: 'widgets', privileges: ['select'] },
        { table: 'gadgets', privileges: ['select'] },
      ],
    });
    expect(grantsDiffer(growing, attrs)).toBe(true);
  });

  test('live PUBLIC holds are one-directional: not revoking is never drift', () => {
    const attrs = attributesOf(live({ schema: { role: ['usage'], public: ['usage'] } }), {
      role: 'seat_writer',
      database: 'agents',
      schema: 'app',
      tables: [],
      columns: [],
      defaults: [],
    });
    expect(grantsDiffer(resolveProps(props), attrs)).toBe(false);
  });
});

describe('clearedDeclaration (the delete twin)', () => {
  const declared = resolveProps({
    ...props,
    tables: [{ table: 'widgets', privileges: ['select'] }],
  });
  test('keeps every name, empties every word list, and turns both PUBLIC flags off', () => {
    const cleared = clearedDeclaration(declared);
    expect(cleared.tables.map((t) => [t.table, t.privileges])).toEqual([['widgets', []]]);
    expect(cleared.schemaPrivileges).toEqual([]);
    expect(cleared.publicSchemaRevoked).toBe(false);
    expect(cleared.role).toBe('seat_writer');
  });

  test('against live grants it plans revoke-only statements, none for PUBLIC', () => {
    const withLive = live({
      schema: { role: ['usage'], public: ['usage'] },
      tables: [{ table: 'widgets', role: ['select'], public: ['select'] }],
    });
    expect(planRepair(clearedDeclaration(declared), withLive)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    ]);
  });
});
