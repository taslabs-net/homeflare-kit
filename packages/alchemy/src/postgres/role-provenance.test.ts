/**
 * Provenance: every `PostgresRoleProps` field traces to a real `CREATE ROLE` synopsis option AND
 * a real `pg_authid`/`pg_auth_members` column, every synopsis option this family does NOT expose
 * is named with a reason, and the `ALTER ROLE` synopsis backs every field the family alters (plus
 * the "memberships move via GRANT and REVOKE" note the membership statements lean on). All four
 * fixtures are parsed, not eyeballed — deleting a fixture line, or adding a prop with no mapping,
 * fails this file (S38, the house's provenance rule).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dir, 'fixtures');
const createRole = readFileSync(join(FIXTURES, 'pg-REL_18_6-create_role.sgml.txt'), 'utf8');
const alterRole = readFileSync(join(FIXTURES, 'pg-REL_18_6-alter_role.sgml.txt'), 'utf8');
const authid = readFileSync(join(FIXTURES, 'pg-REL_18_6-pg_authid.h.txt'), 'utf8');
const authMembers = readFileSync(join(FIXTURES, 'pg-REL_18_6-pg_auth_members.h.txt'), 'utf8');

const CREATE_ROLE_BLOB = 'cee23b1ea6b4dcf2d9d356d07a582e64808c2912';
const ALTER_ROLE_BLOB = '7b0a04bc4637c7c08246e597a9acf4466b467fa2';
const AUTHID_BLOB = 'b2f3e9d01eec972a3392e7037c9679ac644ddc7b';
const AUTH_MEMBERS_BLOB = '387316e44f07982264482f01f2298f4f85ffbafb';

/** Each alternative of a "where <option> can be:" list, normalised to its leading keyword
 * sequence, keeping the optional `[ ENCRYPTED ]` prefix and multi-word forms such as
 * `CONNECTION LIMIT` / `VALID UNTIL` intact. */
const optionTokens = (region: string): readonly string[] => {
  const found: string[] = [];
  for (const line of region.split('\n')) {
    for (const raw of line.split('|')) {
      const m = /^(\[ ENCRYPTED \] )?([A-Z]+(?: [A-Z]+)*)/.exec(raw.trim());
      if (m !== null) found.push(`${m[1] ?? ''}${m[2] as string}`.trim());
    }
  }
  return [...new Set(found)];
};

/** A `CATALOG` struct's column names, from the tab-indicated `type name;` lines. */
const structColumns = (fixture: string): readonly string[] => {
  const re = /^\t[A-Za-z_][A-Za-z0-9_]*\s+(\w+)(?:\[\d+\])?\b/;
  return fixture
    .split('\n')
    .map((line) => re.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
};

/** The create synopsis's option list: from the first `can be:</phrase>` to `</synopsis>`. */
const createOptionsRegion = (): string => {
  const start = createRole.indexOf('can be:</phrase>');
  return createRole.slice(start, createRole.indexOf('</synopsis>', start));
};

/** The first ALTER variant's option list: from the first `can be:</phrase>` to `RENAME TO`. */
const alterOptionsRegion = (): string => {
  const start = alterRole.indexOf('can be:</phrase>');
  return alterRole.slice(start, alterRole.indexOf('RENAME TO', start));
};

/** Every asserted prop except `name`, which is the mandatory `CREATE ROLE <name>` token, checked
 * separately below. A boolean prop claims both its affirmative and its negative option. */
const PROP_MAPPING: Readonly<
  Record<string, { readonly option: string; readonly also?: string; readonly column: string }>
> = {
  login: { option: 'LOGIN', also: 'NOLOGIN', column: 'rolcanlogin' },
  inherit: { option: 'INHERIT', also: 'NOINHERIT', column: 'rolinherit' },
  connectionLimit: { option: 'CONNECTION LIMIT', column: 'rolconnlimit' },
  validUntil: { option: 'VALID UNTIL', column: 'rolvaliduntil' },
  // The value is never a prop (S25): the prop names the environment variable, and the value
  // travels only in the dedicated `ALTER ROLE … WITH PASSWORD` statement.
  password: { option: '[ ENCRYPTED ] PASSWORD', column: 'rolpassword' },
};

/** Every synopsis option this family does NOT declare as a prop, and why. */
const EXCLUDED: Readonly<Record<string, string>> = {
  SUPERUSER:
    'left at the server default (NOSUPERUSER); a stack-minted superuser defeats the least-privilege ledger the estate maintains',
  NOSUPERUSER:
    'the server default for CREATE ROLE; never declared, so the default is what a create lands on',
  CREATEDB:
    "left at the server default (NOCREATEDB); database creation is Postgres.Database's job, not a role prop",
  NOCREATEDB: 'the server default for CREATE ROLE; never declared',
  CREATEROLE:
    'left at the server default (NOCREATEROLE); a CREATEROLE role can manage — and escalate through — other roles',
  NOCREATEROLE: 'the server default for CREATE ROLE; never declared',
  REPLICATION:
    'left at the server default (NOREPLICATION); replication is a cluster-operator concern, never a seat role',
  NOREPLICATION: 'the server default for CREATE ROLE; never declared',
  BYPASSRLS:
    "left at the server default (NOBYPASSRLS); a role bypassing row-level security defeats the estate's ledger model",
  NOBYPASSRLS: 'the server default for CREATE ROLE; never declared',
  'PASSWORD NULL':
    'clears the password; this family never clears one — a password is either declared by reference or left alone',
  'IN ROLE':
    'the create-time membership shorthand; this family writes memberships with one explicit GRANT per parent instead, so the re-read stays authoritative',
  ROLE: 'grants the listed roles membership in the NEW role — the inverse of memberOf; membership is declared in one direction only',
  ADMIN:
    'grants membership with ADMIN OPTION; the seat shape needs no admin option, and pg_auth_members keeps its default',
  SYSID:
    'ignored by the server since PostgreSQL 8.1 (the docs keep it only for compatibility); this family never assigns oids',
};

describe('postgres role provenance', () => {
  test('fixture headers name the measured blob shas', () => {
    expect(createRole).toContain(CREATE_ROLE_BLOB);
    expect(createRole).toContain('doc/src/sgml/ref/create_role.sgml');
    expect(alterRole).toContain(ALTER_ROLE_BLOB);
    expect(alterRole).toContain('doc/src/sgml/ref/alter_role.sgml');
    expect(authid).toContain(AUTHID_BLOB);
    expect(authid).toContain('src/include/catalog/pg_authid.h');
    expect(authMembers).toContain(AUTH_MEMBERS_BLOB);
    expect(authMembers).toContain('src/include/catalog/pg_auth_members.h');
  });

  test('the name token is documented and backed by rolname', () => {
    expect(createRole).toContain('CREATE ROLE <replaceable class="parameter">name</replaceable>');
    expect(structColumns(authid)).toContain('rolname');
  });

  test('every declared prop maps to a real synopsis option (affirmative and negative)', () => {
    const options = optionTokens(createOptionsRegion());
    for (const [prop, { option, also }] of Object.entries(PROP_MAPPING)) {
      expect(options, `prop "${prop}" claims synopsis option "${option}"`).toContain(option);
      if (also !== undefined) {
        expect(options, `prop "${prop}" claims negative option "${also}"`).toContain(also);
      }
    }
  });

  test('every declared prop maps to a real pg_authid column', () => {
    const columns = structColumns(authid);
    for (const [prop, { column }] of Object.entries(PROP_MAPPING)) {
      expect(columns, `prop "${prop}" claims column "${column}"`).toContain(column);
    }
  });

  test('memberOf is backed by the pg_auth_members catalog columns the membership read joins on', () => {
    const columns = structColumns(authMembers);
    expect(columns).toContain('roleid');
    expect(columns).toContain('member');
  });

  test('every synopsis option is either a declared prop or a documented exclusion', () => {
    const declared = new Set(
      Object.values(PROP_MAPPING).flatMap((m) => [
        m.option,
        ...(m.also !== undefined ? [m.also] : []),
      ]),
    );
    for (const option of optionTokens(createOptionsRegion())) {
      const accounted = declared.has(option) || option in EXCLUDED;
      expect(accounted, `synopsis option "${option}" is neither a prop nor in EXCLUDED`).toBe(true);
    }
  });

  test('no excluded option is silently also a declared prop', () => {
    const declared = new Set(
      Object.values(PROP_MAPPING).flatMap((m) => [
        m.option,
        ...(m.also !== undefined ? [m.also] : []),
      ]),
    );
    for (const option of Object.keys(EXCLUDED)) {
      expect(declared.has(option), `"${option}" is both excluded and declared`).toBe(false);
    }
  });

  test('every excluded option actually exists in the synopsis (no stale entries)', () => {
    const options = new Set(optionTokens(createOptionsRegion()));
    for (const option of Object.keys(EXCLUDED)) {
      expect(
        options.has(option),
        `EXCLUDED names "${option}", which the synopsis no longer has`,
      ).toBe(true);
    }
  });

  test('ALTER ROLE backs every field this family alters', () => {
    const alterOptions = optionTokens(alterOptionsRegion());
    for (const option of Object.values(PROP_MAPPING).map((m) => m.option)) {
      expect(alterOptions, `ALTER ROLE cannot set "${option}"`).toContain(option);
    }
  });

  test('ALTER ROLE offers no membership or oid options, which is why memberships move via GRANT/REVOKE', () => {
    const alterOptions = new Set(optionTokens(alterOptionsRegion()));
    for (const option of ['IN ROLE', 'ROLE', 'ADMIN', 'SYSID']) {
      expect(alterOptions.has(option), `ALTER ROLE unexpectedly offers "${option}"`).toBe(false);
    }
  });

  test('the fixture carries the memberships sentence the one-parent GRANT/REVOKE design leans on', () => {
    const stripped = alterRole.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(stripped).toMatch(/no options[^;]*memberships/);
    expect(stripped).toMatch(/use GRANT.{0,20}REVOKE/);
  });

  test('RENAME TO exists in the synopsis — the rename refusal is a choice, not an unknowing gap', () => {
    expect(alterRole).toContain('RENAME TO');
  });
});
