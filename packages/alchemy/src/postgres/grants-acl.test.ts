/**
 * The letter↔word map against PostgreSQL 18.6's own constants. The fixture
 * (`pg-REL_18_6-acl.h.txt`) is parsed in `grants-provenance.test.ts`; here the map's OUTPUT
 * is pinned: the exact letters the server stores for each declared word. There is no
 * `aclitem` text parser to test — the read path goes through `aclexplode`
 * (`grants-read.ts`), never the `grantee=privs/grantor` text shape.
 */
import { describe, expect, test } from 'bun:test';
import {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  grantsNameByteRefusal,
  letterForPrivilege,
} from './grants-attrs.ts';

describe('letterForPrivilege', () => {
  test('maps the table vocabulary to ACL_ALL_RIGHTS_RELATION letters', () => {
    expect([...TABLE_PRIVILEGES].map(letterForPrivilege)).toEqual([
      'r',
      'a',
      'w',
      'd',
      'D',
      'x',
      't',
      'm',
    ]);
  });

  test('maps the schema vocabulary to ACL_ALL_RIGHTS_SCHEMA letters', () => {
    expect([...SCHEMA_PRIVILEGES].map(letterForPrivilege)).toEqual(['U', 'C']);
  });

  test('maps the column vocabulary to ACL_ALL_RIGHTS_COLUMN letters', () => {
    expect([...COLUMN_PRIVILEGES].map(letterForPrivilege)).toEqual(['r', 'a', 'w', 'x']);
  });

  test('CREATE is the UPPERCASE letter, never the lowercase CONNECT letter', () => {
    expect(letterForPrivilege('create')).toBe('C');
    expect(TABLE_PRIVILEGES.some((p) => letterForPrivilege(p) === 'c')).toBe(false);
  });

  test('a word outside the vocabularies throws (the caller validates first, always)', () => {
    expect(() => letterForPrivilege('execute')).toThrow(/no ACL letter/);
    expect(() => letterForPrivilege('connect')).toThrow(/no ACL letter/);
  });
});

describe('grantsNameByteRefusal', () => {
  test('a 64-byte name is refused, a 63-byte one is not', () => {
    expect(grantsNameByteRefusal('a'.repeat(63))).toBeUndefined();
    expect(grantsNameByteRefusal('a'.repeat(64))).toEqual({ byteLength: 64, limit: 63 });
  });

  test('multibyte names count UTF-8 bytes, never JS length', () => {
    // é is 2 UTF-8 bytes: a 32-char string of them is 64 bytes, over the line.
    expect(grantsNameByteRefusal('é'.repeat(32))).toEqual({ byteLength: 64, limit: 63 });
    expect(grantsNameByteRefusal('é'.repeat(31))).toBeUndefined();
  });
});
