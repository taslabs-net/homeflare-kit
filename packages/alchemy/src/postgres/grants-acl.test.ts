/**
 * The letter↔word map and the `aclitem` parser, against PostgreSQL 18.6's own constants —
 * the fixture (`pg-REL_18_6-acl.h.txt`) is parsed in `grants-provenance.test.ts`; here the
 * map's OUTPUT is pinned: the exact letters the server stores for each declared word, the
 * `grantee=privs/grantor` text shape the docs document (`ddl.sgml@REL_18_6`: `calvin=r*w/
 * hobbes`, an empty grantee is PUBLIC), and the refusals for letters outside the family.
 */
import { describe, expect, test } from 'bun:test';
import {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  letterForPrivilege,
  nameByteRefusal,
  parseAclItem,
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

describe('parseAclItem', () => {
  test('parses the docs example: grantee, letters, grantor', () => {
    expect(parseAclItem('calvin=r*w/hobbes')).toEqual({
      grantee: 'calvin',
      letters: 'r*w',
      grantor: 'hobbes',
    });
  });

  test('parses a multi-letter entry with no grant option', () => {
    expect(parseAclItem('miriam=arwdDxtm/miriam')).toEqual({
      grantee: 'miriam',
      letters: 'arwdDxtm',
      grantor: 'miriam',
    });
  });

  test('an empty grantee is PUBLIC and is reported as the empty string', () => {
    expect(parseAclItem('=r/miriam')).toEqual({ grantee: '', letters: 'r', grantor: 'miriam' });
  });

  test('parses quoted names with embedded = and / (aclitemout quotes grantee and grantor)', () => {
    expect(parseAclItem('"a=b"=r/"p/q"')).toEqual({
      grantee: 'a=b',
      letters: 'r',
      grantor: 'p/q',
    });
  });

  test('a doubled quote inside a quoted id is an embedded quote, not a terminator', () => {
    expect(parseAclItem('"a""b"=rw/postgres')).toEqual({
      grantee: 'a"b',
      letters: 'rw',
      grantor: 'postgres',
    });
  });

  test('an unterminated quoted id answers undefined', () => {
    expect(parseAclItem('"a=rw/postgres')).toBeUndefined();
  });

  test('text outside the aclitem shape answers undefined (fail loud in the caller)', () => {
    expect(parseAclItem('not an aclitem')).toBeUndefined();
    expect(parseAclItem('a=b')).toBeUndefined();
    expect(parseAclItem('')).toBeUndefined();
  });

  test('the empty grantee text round-trips through a rebuild', () => {
    const parsed = parseAclItem('=rw/postgres');
    expect(parsed).toBeDefined();
    expect(`${parsed?.grantee}=${parsed?.letters}/${parsed?.grantor}`).toBe('=rw/postgres');
  });
});

describe('nameByteRefusal', () => {
  test('a 64-byte name is refused, a 63-byte one is not', () => {
    expect(nameByteRefusal('a'.repeat(63))).toBeUndefined();
    expect(nameByteRefusal('a'.repeat(64))).toEqual({ byteLength: 64, limit: 63 });
  });

  test('multibyte names count UTF-8 bytes, never JS length', () => {
    // é is 2 UTF-8 bytes: a 32-char string of them is 64 bytes, over the line.
    expect(nameByteRefusal('é'.repeat(32))).toEqual({ byteLength: 64, limit: 63 });
    expect(nameByteRefusal('é'.repeat(31))).toBeUndefined();
  });
});
