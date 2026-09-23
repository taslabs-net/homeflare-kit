/**
 * Provenance: every `PostgresDatabaseProps` field traces to a real `CREATE DATABASE` synopsis
 * option AND a real `pg_database` column, and every synopsis option this family does NOT expose
 * as a prop is named with a reason. Both fixtures are parsed, not eyeballed — deleting a fixture
 * line, or adding a prop with no mapping, fails this file (S38, the house's provenance rule).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dir, 'fixtures');
const synopsis = readFileSync(join(FIXTURES, 'pg-REL_18_6-create-database-synopsis.txt'), 'utf8');
const struct = readFileSync(join(FIXTURES, 'pg-REL_18_6-pg_database.h.txt'), 'utf8');

const SYNOPSIS_BLOB = '4da8aeebb50a29e89bd9f68a8deac4b1a3ec7b18';
const STRUCT_BLOB = '54f0d38c9c9e1cd4d419b05b296b8f84875e9768';

const synopsisOptions = (): readonly string[] => {
  const re = /\[\s*([A-Z][A-Z_ ]*?)\s*(?:\[=\]|=)\s*<replaceable/g;
  const found: string[] = [];
  for (const m of synopsis.matchAll(re)) found.push(m[1] as string);
  return found;
};

const structColumns = (): readonly string[] => {
  const re = /^\t[A-Za-z_][A-Za-z0-9_]*\s+(\w+)(?:\[\d+\])?\b/;
  const found: string[] = [];
  for (const line of struct.split('\n')) {
    const m = re.exec(line);
    if (m !== null) found.push(m[1] as string);
  }
  return found;
};

/** Every asserted prop except `name`, which is the mandatory `CREATE DATABASE <name>` token, not
 * a bracketed `WITH` option — checked separately below. */
const PROP_MAPPING: Readonly<Record<string, { readonly option: string; readonly column: string }>> =
  {
    owner: { option: 'OWNER', column: 'datdba' },
    encoding: { option: 'ENCODING', column: 'encoding' },
    localeProvider: { option: 'LOCALE_PROVIDER', column: 'datlocprovider' },
    lcCollate: { option: 'LC_COLLATE', column: 'datcollate' },
    lcCtype: { option: 'LC_CTYPE', column: 'datctype' },
    allowConnections: { option: 'ALLOW_CONNECTIONS', column: 'datallowconn' },
    connectionLimit: { option: 'CONNECTION LIMIT', column: 'datconnlimit' },
    isTemplate: { option: 'IS_TEMPLATE', column: 'datistemplate' },
    tablespace: { option: 'TABLESPACE', column: 'dattablespace' },
  };

/** Every synopsis option this family does NOT declare as a prop, and why. */
const EXCLUDED: Readonly<Record<string, string>> = {
  TEMPLATE: 'consumed only at create time to copy from; pg_database has no column recording it',
  STRATEGY: 'consumed only at create time (WAL_LOG vs FILE_COPY copy method); not stored',
  LOCALE:
    'a shorthand that sets LC_COLLATE/LC_CTYPE (or BUILTIN_LOCALE); this family declares lcCollate/lcCtype directly instead',
  BUILTIN_LOCALE:
    "only meaningful when localeProvider='builtin'; folds into datcollate/datctype like LOCALE, no column of its own",
  ICU_LOCALE:
    "only meaningful when localeProvider='icu' (datlocale column exists); deferred — measured 2026-09-23, all 24 live databases are locale provider 'c' (libc)",
  ICU_RULES:
    'stored in daticurules, but this family has no ICU-provider consumer yet (see ICU_LOCALE)',
  COLLATION_VERSION:
    'intended for pg_upgrade only; normally omitted so PostgreSQL computes it from the OS',
  OID: 'primarily for pg_upgrade\'s internal use (docs: "only pg_upgrade can specify a value less than 16384"); not something a stack should assert',
};

describe('postgres provenance', () => {
  test('fixture headers name the measured blob shas', () => {
    expect(synopsis).toContain(SYNOPSIS_BLOB);
    expect(synopsis).toContain('doc/src/sgml/ref/create_database.sgml');
    expect(struct).toContain(STRUCT_BLOB);
    expect(struct).toContain('src/include/catalog/pg_database.h');
  });

  test('the name token is documented and backed by datname', () => {
    expect(synopsis).toContain('CREATE DATABASE <replaceable class="parameter">name</replaceable>');
    expect(structColumns()).toContain('datname');
  });

  test('every declared prop maps to a real synopsis option', () => {
    const options = synopsisOptions();
    for (const [prop, { option }] of Object.entries(PROP_MAPPING)) {
      expect(options, `prop "${prop}" claims synopsis option "${option}"`).toContain(option);
    }
  });

  test('every declared prop maps to a real pg_database column', () => {
    const columns = structColumns();
    for (const [prop, { column }] of Object.entries(PROP_MAPPING)) {
      expect(columns, `prop "${prop}" claims column "${column}"`).toContain(column);
    }
  });

  test('every synopsis option is either a declared prop or a documented exclusion', () => {
    const declaredOptions = new Set(Object.values(PROP_MAPPING).map((m) => m.option));
    for (const option of synopsisOptions()) {
      const accounted = declaredOptions.has(option) || option in EXCLUDED;
      expect(accounted, `synopsis option "${option}" is neither a prop nor in EXCLUDED`).toBe(true);
    }
  });

  test('no excluded option is silently also a declared prop', () => {
    const declaredOptions = new Set(Object.values(PROP_MAPPING).map((m) => m.option));
    for (const option of Object.keys(EXCLUDED)) {
      expect(declaredOptions.has(option), `"${option}" is both excluded and declared`).toBe(false);
    }
  });

  test('every excluded option actually exists in the synopsis (no stale entries)', () => {
    const options = new Set(synopsisOptions());
    for (const option of Object.keys(EXCLUDED)) {
      expect(
        options.has(option),
        `EXCLUDED names "${option}", which the synopsis no longer has`,
      ).toBe(true);
    }
  });
});
