/**
 * The statements `Postgres.Role` ever issues, and the one read that backs them.
 *
 * ⛔ `CREATE ROLE` / `ALTER ROLE` TAKE NO BIND PARAMETERS FOR ANY OF THEIR VALUES. Measured at
 *   `gram.y@REL_18_6`: every option value in `CreateOptRoleStmt` is a `RoleSpec`, a signed
 *   `Iconst` or an `Sconst`, and none of those productions reaches `PARAM` (`$n`). Only the
 *   catalog reads below bind a role name (`$1`).
 * ⛔ THE PASSWORD IS THE ONE SECRET THIS FAMILY SENDS AS A LITERAL. Postgres has no bind form for
 *   it in `CREATE`/`ALTER ROLE`, and the point of the prop is to set one. It is quoted with
 *   `quoteStringLiteral` exactly like every other string value, and NEVER written to state —
 *   only its seal is (`role-attrs.ts`, `passwordSeal`).
 * ★ MEMBERSHIP IS TWO ONE-PARENT STATEMENTS (`GRANT` / `REVOKE`), never a multi-role list, so a
 *   partially-failed membership write is observable in the state that remains.
 */
import type { SqlError } from 'effect/unstable/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { quoteIdent, quoteStringLiteral } from './database-sql.ts';
import {
  type PostgresRoleAttributes,
  type PostgresRoleProps,
  sameValidUntil,
} from './role-attrs.ts';

/** The one read: the row from the `pg_roles` view, plus this role's memberships from
 * `pg_auth_members`. `rolvaliduntil` is a `timestamptz`; it is serialised on the server side
 * (`to_char(rolvaliduntil AT TIME ZONE 'UTC', …)`) so the value that reaches state is a plain
 * ISO-8601 string, never a driver-specific Date that `encodeState` would persist differently
 * across transports (the socket client decodes it as a JS Date; the runner transport would hand
 * back a string). */
const SELECT_ROLE_SQL = `SELECT
    r.oid AS oid,
    r.rolname AS name,
    r.rolcanlogin AS login,
    r.rolconnlimit AS "connectionLimit",
    r.rolinherit AS inherit,
    r.rolsuper AS superuser,
    r.rolcreaterole AS createrole,
    r.rolcreatedb AS createdb,
    r.rolreplication AS replication,
    r.rolbypassrls AS bypassrls,
    to_char(r.rolvaliduntil AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "validUntil"
  FROM pg_roles r
  WHERE r.rolname = $1`;

/** `admin_option` and `set_option` ride with the parent name. Upstream `GRANT` defaults `SET`
 * to TRUE (`grant.sgml` at REL_18_6), and `SUPERUSER` / `CREATEROLE` / `CREATEDB` are exercised
 * by `SET ROLE`, not by inheritance (`user-manag.sgml`). A seat grant must say `SET FALSE`. */
const MEMBERSHIP_SQL = `SELECT parent.rolname AS parent,
    m.admin_option AS admin,
    m.set_option AS set
  FROM pg_auth_members m
  JOIN pg_roles member ON member.oid = m.member
  JOIN pg_roles parent ON parent.oid = m.roleid
  WHERE member.rolname = $1
  ORDER BY parent.rolname`;

export const selectRole = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<Omit<PostgresRoleAttributes, 'memberOf' | 'passwordSeal'> | undefined, SqlError> =>
  Effect.map(
    pg.unsafe<Omit<PostgresRoleAttributes, 'memberOf' | 'passwordSeal'>>(SELECT_ROLE_SQL, [name]),
    (rows) => rows[0],
  );

/** One `pg_auth_members` row as this family reads it: the parent name plus the two options a
 * name-only compare would hide. `admin` true is `WITH ADMIN`; `set` true (the `GRANT` default)
 * lets the member `SET ROLE` to the parent. */
export interface MembershipRow {
  readonly parent: string;
  readonly admin: boolean;
  readonly set: boolean;
}

export const selectRoleMemberships = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<readonly MembershipRow[], SqlError> =>
  Effect.map(pg.unsafe<MembershipRow>(MEMBERSHIP_SQL, [name]), (rows) => rows);

/** One combined read used by reconcile, so a no-op reconcile issues exactly one round trip.
 * `passwordSeal` is state-only — `pg_roles` answers no password (S25) — so the caller merges it. */
export const readRoleWithClient = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<Omit<PostgresRoleAttributes, 'passwordSeal'> | undefined, SqlError> =>
  Effect.gen(function* () {
    const row = yield* selectRole(pg, name);
    if (row === undefined) return undefined;
    const memberships = yield* selectRoleMemberships(pg, name);
    return { ...row, memberOf: memberships.map((membership) => membership.parent), memberships };
  });

/** The `WITH` options a create carries, in one place so `diff` and the fake agree on the text.
 * A create carries no PASSWORD clause — the password travels through
 * {@link buildSetPasswordSql}, so the one quoting path for secrets is exercised exactly once
 * and a `CREATE ROLE` never carries a credential in its log line. */
const withOptions = (props: PostgresRoleProps): string => {
  const parts: string[] = [];
  parts.push(props.login ? 'LOGIN' : 'NOLOGIN');
  parts.push(props.inherit ? 'INHERIT' : 'NOINHERIT');
  parts.push(`CONNECTION LIMIT ${String(Math.trunc(props.connectionLimit))}`);
  if (props.validUntil !== undefined) {
    parts.push(`VALID UNTIL ${quoteStringLiteral(props.validUntil)}`);
  }
  return parts.join(' ');
};

export const buildCreateRoleSql = (props: PostgresRoleProps): string =>
  `CREATE ROLE ${quoteIdent(props.name)} WITH ${withOptions(props)}`;

/** One `ALTER ROLE` per drifted scalar. Membership and password are separate statements. */
export const buildAlterRoleSql = (
  name: string,
  change:
    | { prop: 'login'; value: boolean }
    | { prop: 'inherit'; value: boolean }
    | {
        prop: 'connectionLimit';
        value: number;
      }
    | { prop: 'validUntil'; value: string },
): string => {
  const who = quoteIdent(name);
  switch (change.prop) {
    case 'login':
      return `ALTER ROLE ${who} WITH ${change.value ? 'LOGIN' : 'NOLOGIN'}`;
    case 'inherit':
      return `ALTER ROLE ${who} WITH ${change.value ? 'INHERIT' : 'NOINHERIT'}`;
    case 'connectionLimit':
      return `ALTER ROLE ${who} WITH CONNECTION LIMIT ${String(Math.trunc(change.value))}`;
    case 'validUntil':
      return `ALTER ROLE ${who} WITH VALID UNTIL ${quoteStringLiteral(change.value)}`;
  }
};

export const buildSetPasswordSql = (name: string, password: string): string =>
  `ALTER ROLE ${quoteIdent(name)} WITH PASSWORD ${quoteStringLiteral(password)}`;

export const buildDropRoleSql = (name: string): string => `DROP ROLE IF EXISTS ${quoteIdent(name)}`;

/** Seat grants say `SET FALSE`. Upstream `GRANT` defaults `SET` to TRUE, and `SET ROLE` to the
 * parent is how `SUPERUSER` / `CREATEROLE` / `CREATEDB` are exercised (`user-manag.sgml`). */
export const buildGrantMembershipSql = (member: string, parent: string): string =>
  `GRANT ${quoteIdent(parent)} TO ${quoteIdent(member)} WITH SET FALSE`;

export const buildRevokeMembershipSql = (member: string, parent: string): string =>
  `REVOKE ${quoteIdent(parent)} FROM ${quoteIdent(member)}`;

/** Compare every declared scalar prop against the live row; answer the list of statements
 * reconcile needs to run, empty when nothing drifted. `name` is compared by the caller. */
export const scalarDrift = (
  props: PostgresRoleProps,
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): ReadonlyArray<Parameters<typeof buildAlterRoleSql>[1]> => {
  const changes: Parameters<typeof buildAlterRoleSql>[1][] = [];
  if (props.login !== live.login) changes.push({ prop: 'login', value: props.login });
  if (props.inherit !== live.inherit) changes.push({ prop: 'inherit', value: props.inherit });
  if (props.connectionLimit !== live.connectionLimit) {
    changes.push({ prop: 'connectionLimit', value: props.connectionLimit });
  }
  // Instant comparison, never string equality: the server serialises `rolvaliduntil` with
  // milliseconds, so `'2027-01-01T00:00:00Z'` (declared) and `'2027-01-01T00:00:00.000Z'`
  // (read back) are the same value and must not churn an `ALTER` on every plan.
  if (props.validUntil !== undefined && !sameValidUntil(props.validUntil, live.validUntil)) {
    changes.push({ prop: 'validUntil', value: props.validUntil });
  }
  return changes;
};

/** Drop the observe-only membership options before attributes reach state. `diff` compares
 * `memberOf`; the options are read live on the next reconcile. */
export const storedAttributes = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): Omit<PostgresRoleAttributes, 'passwordSeal'> => {
  const { memberships: _observeOnly, ...stored } = live;
  return stored;
};

/** Grant what the declaration wants and revoke what it does not. `undefined` leaves live alone;
 * answers the declared set (sorted, de-duplicated), or the live set when nothing was declared.
 * `unsafe` parents are revoked and granted again — their name matched, their options did not. */
export const syncMemberships = (
  pg: PgExecutor,
  props: PostgresRoleProps,
  live: readonly string[],
  unsafe: ReadonlySet<string> = new Set(),
): Effect.Effect<readonly string[], SqlError> =>
  Effect.gen(function* () {
    const { grants, revokes } = membershipDrift(props.memberOf, live, unsafe);
    for (const parent of grants) {
      yield* pg.unsafe(buildGrantMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    for (const parent of revokes) {
      yield* pg.unsafe(buildRevokeMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    return props.memberOf === undefined ? live : [...new Set(props.memberOf)].sort();
  });

/** Catalog flags this family never declares. A create lands on the server default (all false);
 * an absent field on a seeded test row is that default. */
export const privilegedFlags = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): readonly string[] => {
  const flags: string[] = [];
  if (live.superuser === true) flags.push('SUPERUSER');
  if (live.createrole === true) flags.push('CREATEROLE');
  if (live.createdb === true) flags.push('CREATEDB');
  if (live.replication === true) flags.push('REPLICATION');
  if (live.bypassrls === true) flags.push('BYPASSRLS');
  return flags;
};

/** Parents whose `pg_auth_members` row carries ADMIN, or SET at the upstream default TRUE. */
export const unsafeMemberships = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): ReadonlySet<string> =>
  new Set((live.memberships ?? []).filter((row) => row.admin || row.set).map((row) => row.parent));

/** Membership drift: sorted set difference between declared and live. Duplicates in the
 * declaration collapse to one; `undefined` means "not asserted" — nothing to grant or revoke.
 * A parent already granted `WITH ADMIN`, or with `SET` still at the upstream default TRUE, is
 * a grant again: the name matches, but the options do not, so reconcile revokes and re-grants. */
export const membershipDrift = (
  declared: readonly string[] | undefined,
  live: readonly string[],
  unsafe: ReadonlySet<string> = new Set(),
): { readonly grants: readonly string[]; readonly revokes: readonly string[] } => {
  if (declared === undefined) return { grants: [], revokes: [] };
  const wanted = [...new Set(declared)].sort();
  const current = [...live].sort();
  return {
    grants: wanted.filter((parent) => !current.includes(parent) || unsafe.has(parent)),
    revokes: [
      ...current.filter((parent) => !wanted.includes(parent)),
      ...wanted.filter((parent) => current.includes(parent) && unsafe.has(parent)),
    ],
  };
};
