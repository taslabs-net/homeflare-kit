/**
 * Every plan-time refusal and the `diff` sweep, checked without a client: the retarget
 * refusal (role/database/schema), `diff` never answering `replace`, the privilege/duplicate/
 * name refusals through `diff`, and `defaultRemovalPolicy: 'retain'` declared in source.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import { diffPostgresGrants } from './grants.ts';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import {
  PostgresGrantsDuplicateObject,
  PostgresGrantsNameRefused,
  PostgresGrantsPrivilegeRefused,
  PostgresGrantsRetargetRefused,
} from './grants-errors.ts';

const base: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
};

const output: PostgresGrantsAttributes = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaPrivileges: ['usage'],
  tables: [{ table: 'widgets', privileges: ['select'] }],
  columns: [],
  defaults: [],
  publicSchemaRevoked: true,
  publicTablesRevoked: true,
};

describe('diff: retarget refusals', () => {
  test('a changed role, database or schema is refused, never a silent update', async () => {
    for (const [prop, value] of [
      ['role', 'other_role'],
      ['database', 'other_db'],
      ['schema', 'other_schema'],
    ] as const) {
      const error = await Effect.runPromise(
        Effect.flip(diffPostgresGrants({ ...base, [prop]: value }, output)),
      );
      expect(error, prop).toBeInstanceOf(PostgresGrantsRetargetRefused);
      expect((error as PostgresGrantsRetargetRefused).prop).toBe(prop);
    }
  });
});

describe('diff: declarations', () => {
  test('a declaration matching the attributes answers noop', async () => {
    const result = await Effect.runPromise(
      diffPostgresGrants(
        { ...base, tables: [{ table: 'widgets', privileges: ['select'] }] },
        output,
      ),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('any word change, new table or new PUBLIC revoke answers update, NEVER replace', async () => {
    const variants: ReadonlyArray<Partial<PostgresGrantsProps>> = [
      { tables: [{ table: 'widgets', privileges: ['select', 'insert'] }] },
      {
        tables: [
          { table: 'widgets', privileges: ['select'] },
          { table: 'gadgets', privileges: ['select'] },
        ],
      },
      { schemaUsage: false },
      { columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }] },
      { defaultPrivileges: [{ forRole: 'owner', privileges: ['select'] }] },
    ];
    for (const variant of variants) {
      const result = await Effect.runPromise(
        diffPostgresGrants(
          { ...base, tables: [{ table: 'widgets', privileges: ['select'] }], ...variant },
          output,
        ),
      );
      expect(result?.action, `variant ${JSON.stringify(variant)}`).toBe('update');
      expect(result).not.toEqual({ action: 'replace' });
    }
  });

  test('the plan-time refusals surface through diff: privilege, duplicate, name', async () => {
    const privilege = await Effect.runPromise(
      Effect.flip(
        diffPostgresGrants(
          { ...base, tables: [{ table: 'widgets', privileges: ['execute'] }] },
          output,
        ),
      ),
    );
    expect(privilege).toBeInstanceOf(PostgresGrantsPrivilegeRefused);

    const duplicate = await Effect.runPromise(
      Effect.flip(
        diffPostgresGrants(
          {
            ...base,
            tables: [
              { table: 'widgets', privileges: ['select'] },
              { table: 'widgets', privileges: ['insert'] },
            ],
          },
          output,
        ),
      ),
    );
    expect(duplicate).toBeInstanceOf(PostgresGrantsDuplicateObject);

    // The over-long name must not also be a retarget (role/database/schema), so the byte
    // limit is exercised through a table name while identity stays unchanged.
    const name = await Effect.runPromise(
      Effect.flip(
        diffPostgresGrants(
          { ...base, tables: [{ table: 'a'.repeat(64), privileges: ['select'] }] },
          output,
        ),
      ),
    );
    expect(name).toBeInstanceOf(PostgresGrantsNameRefused);
  });
});

describe('removal policy', () => {
  test('defaultRemovalPolicy is retain (declared alongside PostgresGrants, checked in source)', () => {
    const source = readFileSync(new URL('./grants.ts', import.meta.url), 'utf8');
    expect(source).toContain("defaultRemovalPolicy: 'retain'");
  });
});
