/**
 * The pure declaration layer: `resolveProps`' defaults and normalization, the declaration
 * refusals (vocabulary, plain-vs-starred conflict, duplicates, name length) and
 * `splitGrantWords`. The repair and revocation planners live in
 * `grants-repair-plan.test.ts`; the projection and comparison in `grants-plan-diff.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import { declarationRefusal, grantsNamesRefusal } from './grants-refuse.ts';
import { resolveProps, splitGrantWords } from './grants-declare.ts';

const props: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
};

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

  test('a base word declared both plain and WITH GRANT OPTION is refused — the server keeps one aclitem per grantee per grantor, so the pair can never converge', () => {
    expect(
      declarationRefusal(
        resolveProps({
          ...props,
          tables: [{ table: 'widgets', privileges: ['select', 'select*'] }],
        }),
      ),
    ).toEqual({ kind: 'duplicate', prop: 'tables.widgets', name: 'select' });
    expect(
      declarationRefusal(
        resolveProps({
          ...props,
          columnGrants: [{ table: 'widgets', column: 'id', privileges: ['update', 'update*'] }],
        }),
      ),
    ).toEqual({ kind: 'duplicate', prop: 'columnGrants.widgets.id', name: 'update' });
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

describe('splitGrantWords', () => {
  test('splits by the trailing mark, order preserved', () => {
    expect(splitGrantWords(['select', 'insert*', 'update'])).toEqual({
      plain: ['select', 'update'],
      grantable: ['insert*'],
    });
  });
});
