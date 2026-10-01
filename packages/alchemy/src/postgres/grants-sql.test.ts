/**
 * The statement builders' exact output: every identifier `quoteIdent`ed, every clause in the
 * one order the parser (`fake-grants-parse.ts`, in tests) and a real server accept, and the
 * mixed grant-option refusal that protects the declaration from over-granting (one
 * `WITH GRANT OPTION` clause would grant the option to EVERY listed privilege).
 */
import { describe, expect, test } from 'bun:test';
import {
  grantColumnSql,
  grantDefaultSql,
  grantSchemaSql,
  grantTableSql,
  revokeColumnSql,
  revokeDefaultSql,
  revokePublicSchemaSql,
  revokePublicTablesSql,
  revokeSchemaSql,
  revokeTableSql,
} from './grants-sql.ts';

describe('grant builders', () => {
  test('a table grant lists words comma-separated on the qualified relation', () => {
    expect(grantTableSql('app', 'widgets', 'seat_writer', ['select', 'insert'])).toBe(
      'GRANT select, insert ON "app"."widgets" TO "seat_writer"',
    );
  });

  test('a grant-option list carries exactly one WITH GRANT OPTION clause at the end', () => {
    expect(grantTableSql('app', 'widgets', 'seat_writer', ['select*'])).toBe(
      'GRANT select ON "app"."widgets" TO "seat_writer" WITH GRANT OPTION',
    );
  });

  test('a MIXED list throws instead of over-granting the option to the plain words', () => {
    expect(() => grantTableSql('app', 'widgets', 'seat_writer', ['select', 'insert*'])).toThrow(
      /mixed grant-option list/,
    );
  });

  test('an out-of-vocabulary word is refused before it reaches a GRANT clause', () => {
    // The builders are exported API, so the vocabulary check lives inside them, not only
    // in the resource path: an injected fragment can never be concatenated into SQL.
    expect(() => grantTableSql('app', 'widgets', 'seat_writer', ['select', 'execute'])).toThrow(
      /not a privilege/,
    );
    expect(() => grantTableSql('app', 'widgets', 'seat_writer', ['*'])).toThrow(/not a privilege/);
  });

  test('a column grant parenthesizes the column after the words', () => {
    expect(grantColumnSql('app', 'widgets', 'id', 'seat_writer', ['select'])).toBe(
      'GRANT select ("id") ON "app"."widgets" TO "seat_writer"',
    );
  });

  test('a multi-word column grant repeats the synopsis per word', () => {
    // One trailing column list binds only to the privilege it follows (gram.y@REL_18_6):
    // `GRANT select, update ("id")` is a table-level SELECT plus a column-level UPDATE.
    // Every word carries its own list, so all of them land on the column and nothing on
    // the relation — a grant the declaration did not name is never issued.
    expect(grantColumnSql('app', 'widgets', 'amount', 'seat_writer', ['select', 'update'])).toBe(
      'GRANT select ("amount"), update ("amount") ON "app"."widgets" TO "seat_writer"',
    );
    expect(grantColumnSql('app', 'widgets', 'amount', 'seat_writer', ['select*', 'update*'])).toBe(
      'GRANT select ("amount"), update ("amount") ON "app"."widgets" TO "seat_writer" WITH GRANT OPTION',
    );
  });

  test('a schema grant names SCHEMA, not a relation', () => {
    expect(grantSchemaSql('app', 'seat_writer', ['usage'])).toBe(
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
    );
  });

  test('a default-privileges grant carries FOR ROLE (the creator) IN SCHEMA, grantee last', () => {
    expect(grantDefaultSql('app', 'ledger_owner', 'seat_writer', ['select'])).toBe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "ledger_owner" IN SCHEMA "app" GRANT select ON TABLES TO "seat_writer"',
    );
  });
});

describe('revoke builders', () => {
  test('a table revoke', () => {
    expect(revokeTableSql('app', 'widgets', 'seat_writer')).toBe(
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    );
  });

  test('a column revoke', () => {
    expect(revokeColumnSql('app', 'widgets', 'id', 'seat_writer')).toBe(
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
    );
  });

  test('a schema revoke', () => {
    expect(revokeSchemaSql('app', 'seat_writer')).toBe(
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
    );
  });

  test('a default-privileges revoke', () => {
    expect(revokeDefaultSql('app', 'ledger_owner', 'seat_writer')).toBe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "ledger_owner" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "seat_writer"',
    );
  });

  test('the PUBLIC schema revoke uses the bare keyword, never a quoted role', () => {
    expect(revokePublicSchemaSql('app')).toBe('REVOKE ALL ON SCHEMA "app" FROM PUBLIC');
  });

  test('the PUBLIC tables revoke clears every relation in the schema', () => {
    expect(revokePublicTablesSql('app')).toBe(
      'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC',
    );
  });
});

describe('quoting', () => {
  test('embedded quotes and hyphens survive in every position', () => {
    expect(grantTableSql('a"b', 'weird-name', 'x y', ['select'])).toBe(
      'GRANT select ON "a""b"."weird-name" TO "x y"',
    );
    // A single quote needs no doubling inside a double-quoted identifier — only the
    // identifier quote character ("") is doubled (grant.sgml@REL_18_6, SQL syntax).
    expect(grantColumnSql('a"b', 'weird-name', "it's", 'x y', ['select'])).toBe(
      `GRANT select ("it's") ON "a""b"."weird-name" TO "x y"`,
    );
  });
});
