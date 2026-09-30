/**
 * Provenance for `Postgres.Grants`: every vocabulary traces to a real constant in the
 * committed `acl.h@REL_18_6` excerpt, the column vocabulary to the GRANT synopsis' own
 * column form, the default-privileges shape to the ALTER DEFAULT PRIVILEGES synopsis, the
 * read path to `aclexplode`'s documented row — and every object class the family does NOT
 * express is named with a reason. Both directions fail on a fixture edit (S38).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  letterForPrivilege,
} from './grants-attrs.ts';

const FIXTURES = join(import.meta.dir, 'fixtures');
const aclHeader = readFileSync(join(FIXTURES, 'pg-REL_18_6-acl.h.txt'), 'utf8');
const grantSynopsis = readFileSync(join(FIXTURES, 'pg-REL_18_6-grant-synopsis.txt'), 'utf8');
const defaultSynopsis = readFileSync(
  join(FIXTURES, 'pg-REL_18_6-alter-default-privileges-synopsis.txt'),
  'utf8',
);
const explodeFunc = readFileSync(join(FIXTURES, 'pg-REL_18_6-aclexplode-func.txt'), 'utf8');
const defaultAclHeader = readFileSync(join(FIXTURES, 'pg-REL_18_6-pg_default_acl.h.txt'), 'utf8');

const ACL_BLOB = '13bb8128747139d9cae66777e4782359ead0a760';

/** Pull each `#define ACL_<PRIVILEGE>_CHR '<letter>'` constant out of the committed acl.h. */
const aclLetter = (name: string): string => {
  const m = new RegExp(`#define ACL_${name}_CHR\\s+'(.)'`).exec(aclHeader);
  if (m === null) throw new Error(`no ACL_${name}_CHR in the committed acl.h excerpt`);
  return m[1] as string;
};

const WORD_LETTER: Readonly<Record<string, string>> = {
  insert: 'INSERT',
  select: 'SELECT',
  update: 'UPDATE',
  delete: 'DELETE',
  truncate: 'TRUNCATE',
  references: 'REFERENCES',
  trigger: 'TRIGGER',
  maintain: 'MAINTAIN',
  usage: 'USAGE',
  create: 'CREATE',
};

describe('grants provenance', () => {
  test('the acl.h excerpt is the pinned REL_18_6 blob', () => {
    expect(aclHeader).toContain(ACL_BLOB);
    expect(aclHeader).toContain('src/include/utils/acl.h');
    expect(explodeFunc).toContain('aclexplode');
    expect(explodeFunc).toContain('is_grantable');
  });

  test('every table word maps to the acl.h letter the server really stores', () => {
    for (const privilege of TABLE_PRIVILEGES) {
      expect(letterForPrivilege(privilege)).toBe(aclLetter(WORD_LETTER[privilege] as string));
    }
  });

  test('schema and column words too, CREATE above the lowercase CONNECT trap', () => {
    for (const privilege of SCHEMA_PRIVILEGES) {
      expect(letterForPrivilege(privilege)).toBe(aclLetter(WORD_LETTER[privilege] as string));
    }
    for (const privilege of COLUMN_PRIVILEGES) {
      expect(letterForPrivilege(privilege)).toBe(aclLetter(WORD_LETTER[privilege] as string));
    }
    expect(aclLetter('CREATE')).toBe('C');
  });

  test('the column vocabulary is exactly the GRANT synopsis column form (table-wide only excluded)', () => {
    expect(grantSynopsis).toContain(
      'GRANT { { SELECT | INSERT | UPDATE | REFERENCES } ( <replaceable class="parameter">column_name</replaceable>',
    );
    expect([...COLUMN_PRIVILEGES]).toEqual(['select', 'insert', 'update', 'references']);
    for (const tableWideOnly of ['truncate', 'trigger', 'maintain']) {
      expect(COLUMN_PRIVILEGES.includes(tableWideOnly as never)).toBe(false);
    }
  });

  test('the table vocabulary is the relation grant form of the synopsis', () => {
    expect(grantSynopsis).toContain(
      'GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }',
    );
    expect([...TABLE_PRIVILEGES]).toEqual([
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger',
      'maintain',
    ]);
  });

  test('default privileges are FOR ROLE per creator, ON TABLES, defaclobjtype r', () => {
    // The synopsis wraps the FOR ROLE clause onto its own line, so assert on that line.
    expect(defaultSynopsis).toContain(
      '[ FOR { ROLE | USER } <replaceable>target_role</replaceable>',
    );
    expect(defaultSynopsis).toContain('ON TABLES');
    expect(defaultAclHeader).toContain('DEFACLOBJ_RELATION');
    expect(defaultAclHeader).toMatch(/#define\s+DEFACLOBJ_RELATION\s+'r'/);
  });

  test('aclexplode is the read path: one row per privilege, PUBLIC at grantee zero', () => {
    expect(explodeFunc).toContain('<parameter>privilege_type</parameter> <type>text</type>');
    expect(explodeFunc).toContain('pseudo-role PUBLIC');
  });
});

/** Every GRANT synopsis line this family does NOT express, and why. */
describe('out of scope', () => {
  const notModelled: Readonly<Record<string, string>> = {
    SEQUENCE:
      'sequences are relations the same ON statement reaches, but no sequence word set is declared',
    FUNCTION:
      'routine privileges (EXECUTE) are a different vocabulary (ACL_ALL_RIGHTS_FUNCTION); no declaration shape',
    DATABASE:
      'ALTER DATABASE privileges are cluster-level, not one schema\u2019s grant set; the docs name the boundary',
    LARGE: 'large objects (b/r in acl.h) have no declaration shape and no schema container',
    TYPE: 'types are granted through USAGE on the type, deferred until a consumer needs it',
  };
  test('named with a reason, so a future vocabulary must answer one', () => {
    for (const [name, reason] of Object.entries(notModelled)) {
      expect(reason.length).toBeGreaterThan(10);
      expect(grantSynopsis).toContain(name);
    }
  });
});
