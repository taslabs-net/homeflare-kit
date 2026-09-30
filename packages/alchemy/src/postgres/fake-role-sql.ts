/**
 * The `Postgres.Role` half of `fake-sql.ts`: the in-memory `pg_roles` / `pg_auth_members` catalog
 * and every statement branch that touches it, split out so each fake file serves one family.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL (the rule `fake-sql.ts` documents). Every
 *   parser here understands exactly the text `role-sql.ts` produces — quoted with `quoteIdent` /
 *   `quoteStringLiteral` — because that is the only `CREATE ROLE`, per-field `ALTER ROLE`,
 *   `GRANT`, `REVOKE` and `DROP ROLE` this family ever issues. A general SQL parser would hide a
 *   quoting bug instead of tripping over it.
 * ★ THE DEDICATED PASSWORD `ALTER ROLE … WITH PASSWORD` IS RECORDED, NEVER PARSED: `pg_roles`
 *   answers no password value (S25), so the fake stores none either — the seal lives only in the
 *   attributes a test seeds or a reconcile returns.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresRoleAttributes } from './role-attrs.ts';
import { unquoteIdent, unquoteLiteral } from './fake-sql-quote.ts';

/** The role catalog `fake-sql.ts` constructs and shares with its callers: seeded by a test, then
 * mutated by the statements this module applies. */
export interface FakeRoleState {
  /** Bare role names, backing the `roleExists` check the database family's owner probe uses. */
  readonly roleNames: Set<string>;
  readonly roleRows: Map<string, PostgresRoleAttributes>;
  /** `member\0parent` pairs backing `pg_auth_members`; `GRANT`/`REVOKE` mutate it. */
  readonly memberships: Set<string>;
  /** Hands out the next `oid` a real cluster would assign. */
  nextOid(): number;
}

type RoleRow = Omit<PostgresRoleAttributes, 'memberOf' | 'passwordSeal'>;

/** Pull every field back out of exactly the text `buildCreateRoleSql` writes. The password never
 * rides a `CREATE ROLE`, so this parses no secret. */
const parseCreateRole = (text: string): RoleRow => {
  const name = /^CREATE ROLE "((?:[^"]|"")*)" WITH /.exec(text);
  const login = /(?:^| )(NOLOGIN|LOGIN)(?: |$)/.exec(text);
  const inherit = /(?:^| )(NOINHERIT|INHERIT)(?: |$)/.exec(text);
  const limit = /CONNECTION LIMIT (-?\d+)/.exec(text);
  const until = /VALID UNTIL '((?:[^']|'')*)'/.exec(text);
  if (name === null) {
    throw new Error(`fake-sql: could not parse a generated CREATE ROLE statement: ${text}`);
  }
  return {
    name: unquoteIdent(name[1] as string),
    oid: 0,
    login: login?.[1] !== 'NOLOGIN',
    inherit: inherit?.[1] !== 'NOINHERIT',
    connectionLimit: limit === null ? -1 : Number(limit[1]),
    validUntil: until === null ? null : unquoteLiteral(until[1] as string),
  };
};

/** A per-field `ALTER ROLE … WITH …`, parsed back into the one scalar it changes. */
const parseAlterRole = (text: string): Partial<RoleRow> => {
  const name = /^ALTER ROLE "((?:[^"]|"")*)" WITH /.exec(text);
  if (name === null) {
    throw new Error(`fake-sql: could not parse a generated ALTER ROLE statement: ${text}`);
  }
  const who = unquoteIdent(name[1] as string);
  const until = /VALID UNTIL '((?:[^']|'')*)'/.exec(text);
  const limit = /CONNECTION LIMIT (-?\d+)/.exec(text);
  const login = /(?:^| )(NOLOGIN|LOGIN)(?: |$)/.exec(text);
  const inherit = /(?:^| )(NOINHERIT|INHERIT)(?: |$)/.exec(text);
  // The dedicated password statement carries no catalog-visible field; it is recorded by text
  // only and never parsed back, because pg_roles answers no password value (S25).
  if (/ PASSWORD /.test(text)) return { name: who };
  if (until !== null) return { name: who, validUntil: unquoteLiteral(until[1] as string) };
  if (limit !== null) return { name: who, connectionLimit: Number(limit[1]) };
  if (login !== null) return { name: who, login: login[1] !== 'NOLOGIN' };
  if (inherit !== null) return { name: who, inherit: inherit[1] !== 'NOINHERIT' };
  throw new Error(`fake-sql: unrecognised ALTER ROLE field: ${text}`);
};

const EMPTY_ROLE: RoleRow = {
  name: '',
  oid: 0,
  login: false,
  connectionLimit: -1,
  inherit: true,
  validUntil: null,
};

/**
 * Every `Postgres.Role` statement and both role reads, applied against the fake catalog. Answers
 * the effect the statement produces — `undefined` when the text belongs to another family, so
 * `fake-sql.ts` can fall through to its own branches.
 */
export const applyRoleStatement = <A extends object>(
  state: FakeRoleState,
  text: string,
  params: ReadonlyArray<unknown>,
): Effect.Effect<ReadonlyArray<A>, SqlError> | undefined => {
  if (text.includes('FROM pg_auth_members')) {
    const member = params[0] as string;
    const parents = [...state.memberships]
      .filter((pair) => pair.split('\0')[0] === member)
      .map((pair) => pair.split('\0')[1] as string)
      .sort();
    return Effect.succeed(parents.map((parent) => ({ parent })) as unknown as ReadonlyArray<A>);
  }

  if (text.includes('FROM pg_roles r')) {
    const name = params[0] as string;
    const row = state.roleRows.get(name);
    // pg_roles answers no password value (S25): even a seeded seal is not read back — state
    // holds it, and a reconcile receives it explicitly, the same way the real server answers.
    if (row === undefined) return Effect.succeed([] as unknown as ReadonlyArray<A>);
    const { passwordSeal: _stateOnly, ...catalog } = row;
    return Effect.succeed([catalog] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('CREATE ROLE')) {
    const parsed = { ...EMPTY_ROLE, ...parseCreateRole(text), oid: state.nextOid() };
    state.roleRows.set(parsed.name, { ...parsed, memberOf: [], passwordSeal: '' });
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('ALTER ROLE')) {
    const parsed = parseAlterRole(text);
    const row = state.roleRows.get(parsed.name ?? '');
    if (row === undefined) {
      throw new Error(`fake-sql: ALTER ROLE on absent role "${String(parsed.name)}"`);
    }
    state.roleRows.set(row.name, { ...row, ...parsed });
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('GRANT')) {
    const m = /^GRANT "((?:[^"]|"")*)" TO "((?:[^"]|"")*)"$/.exec(text);
    if (m === null) {
      throw new Error(`fake-sql: could not parse a generated GRANT statement: ${text}`);
    }
    state.memberships.add(`${unquoteIdent(m[2] as string)}\0${unquoteIdent(m[1] as string)}`);
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('REVOKE')) {
    const m = /^REVOKE "((?:[^"]|"")*)" FROM "((?:[^"]|"")*)"$/.exec(text);
    if (m === null) {
      throw new Error(`fake-sql: could not parse a generated REVOKE statement: ${text}`);
    }
    state.memberships.delete(`${unquoteIdent(m[2] as string)}\0${unquoteIdent(m[1] as string)}`);
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('DROP ROLE')) {
    const m = /^DROP ROLE IF EXISTS "((?:[^"]|"")*)"$/.exec(text);
    if (m === null) {
      throw new Error(`fake-sql: could not parse a generated DROP ROLE statement: ${text}`);
    }
    const name = unquoteIdent(m[1] as string);
    state.roleRows.delete(name);
    state.roleNames.delete(name);
    for (const pair of state.memberships) {
      if (pair.split('\0')[0] === name || pair.split('\0')[1] === name)
        state.memberships.delete(pair);
    }
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  return undefined;
};
