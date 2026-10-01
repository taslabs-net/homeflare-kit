/**
 * The read-back projection (`attributesOf`), the plan-time comparison (`grantsDiffer`) and
 * the cleared twin `delete` replays (`clearedDeclaration`). The declaration refusals and the
 * repair planners live in `grants-plan.test.ts` and `grants-repair-plan.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import { clearedDeclaration, resolveProps } from './grants-declare.ts';
import { attributesOf, grantsDiffer } from './grants-diff.ts';
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

const names = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  tables: ['widgets'],
  columns: [],
  defaults: [],
};

describe('attributesOf', () => {
  const fresh = live({
    schema: { role: ['usage'], public: [] },
    tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
  });

  test('attributes record the role words on the named objects and the PUBLIC facts', () => {
    const attrs = attributesOf(fresh, names);
    expect(attrs.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(attrs.publicSchemaRevoked).toBe(true);
    expect(attrs.publicTablesRevoked).toBe(true);
  });

  test('attributes record the ownership facts; an owned object records an empty word list', () => {
    const attrs = attributesOf(
      live({
        schemaOwnedByRole: true,
        ownedTables: ['widgets'],
        tables: [{ table: 'widgets', relkind: 'r', role: [], public: [] }],
      }),
      names,
    );
    expect(attrs.schemaOwnedByRole).toBe(true);
    expect(attrs.ownedTables).toEqual(['widgets']);
    expect(attrs.tables).toEqual([{ table: 'widgets', privileges: [] }]);
    // The PUBLIC fact is scoped to the relkinds the bulk revoke reaches: a sequence
    // outside that reach cannot hold the fact back.
    const sequence = attributesOf(
      live({ tables: [{ table: 'app_seq', relkind: 'S', role: [], public: ['usage'] }] }),
      { ...names, tables: ['app_seq'] },
    );
    expect(sequence.publicTablesRevoked).toBe(true);
  });

  test('a PUBLIC hold with the flag off is recorded as not revoked', () => {
    const attrs = attributesOf(live({ schema: { role: ['usage'], public: ['usage'] } }), {
      ...names,
      tables: [],
    });
    expect(attrs.publicSchemaRevoked).toBe(false);
  });
});

describe('grantsDiffer', () => {
  const declared = resolveProps({
    ...props,
    tables: [{ table: 'widgets', privileges: ['select'] }],
  });
  const fresh = live({
    schema: { role: ['usage'], public: [] },
    tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
  });

  test('equal declarations answer noop; a word, a name-set change and identity answer update', () => {
    const attrs = attributesOf(fresh, names);
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

  test('a flipped COLUMN word and a flipped DEFAULT word answer update, marks included', () => {
    // The baseline (schema words + table words) is what the plain declaration already
    // holds, so ONLY the flipped column or default word can answer update.
    const baseline = {
      schema: { role: ['usage'], public: [] },
      tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
    };
    const withColumn = attributesOf(
      live({
        ...baseline,
        columns: [
          { table: 'widgets', column: 'id', role: ['select'], public: [], restorable: ['select'] },
        ],
      }),
      { ...names, columns: [{ table: 'widgets', column: 'id' }] },
    );
    expect(
      grantsDiffer(
        { ...declared, columns: [{ table: 'widgets', column: 'id', privileges: ['select'] }] },
        withColumn,
      ),
    ).toBe(false);
    expect(
      grantsDiffer(
        { ...declared, columns: [{ table: 'widgets', column: 'id', privileges: ['select*'] }] },
        withColumn,
      ),
    ).toBe(true);

    const withDefault = attributesOf(
      live({ ...baseline, defaults: [{ forRole: 'owner_role', role: ['select'] }] }),
      { ...names, defaults: ['owner_role'] },
    );
    expect(
      grantsDiffer(
        { ...declared, defaults: [{ forRole: 'owner_role', privileges: ['select'] }] },
        withDefault,
      ),
    ).toBe(false);
    expect(
      grantsDiffer(
        { ...declared, defaults: [{ forRole: 'owner_role', privileges: ['insert'] }] },
        withDefault,
      ),
    ).toBe(true);
  });

  test('an owned object\u2019s word change is never drift; only its name set can answer update', () => {
    const attrs = attributesOf(
      live({
        schemaOwnedByRole: true,
        ownedTables: ['widgets'],
        tables: [{ table: 'widgets', relkind: 'r', role: [], public: [] }],
      }),
      names,
    );
    expect(grantsDiffer(declared, attrs)).toBe(false);
    expect(
      grantsDiffer({ ...declared, tables: [{ table: 'widgets', privileges: ['insert'] }] }, attrs),
    ).toBe(false);
    expect(
      grantsDiffer({ ...declared, tables: [{ table: 'other', privileges: ['select'] }] }, attrs),
    ).toBe(true);
  });

  test('live PUBLIC holds are one-directional: not revoking is never drift', () => {
    const attrs = attributesOf(live({ schema: { role: ['usage'], public: ['usage'] } }), {
      ...names,
      tables: [],
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
      tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: ['select'] }],
    });
    expect(planRepair(clearedDeclaration(declared), withLive)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    ]);
  });
});
