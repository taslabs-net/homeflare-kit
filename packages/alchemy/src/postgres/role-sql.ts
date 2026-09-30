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
    to_char(r.rolvaliduntil AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "validUntil"
  FROM pg_roles r
  WHERE r.rolname = $1`;

const MEMBERSHIP_SQL = `SELECT parent.rolname AS parent
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

export const selectRoleMemberships = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<readonly string[], SqlError> =>
  Effect.map(pg.unsafe<{ readonly parent: string }>(MEMBERSHIP_SQL, [name]), (rows) =>
    rows.map((row) => row.parent),
  );

/** One combined read used by reconcile, so a no-op reconcile issues exactly one round trip.
 * `passwordSeal` is state-only — `pg_roles` answers no password (S25) — so the caller merges it. */
export const readRoleWithClient = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<Omit<PostgresRoleAttributes, 'passwordSeal'> | undefined, SqlError> =>
  Effect.gen(function* () {
    const row = yield* selectRole(pg, name);
    if (row === undefined) return undefined;
    const memberOf = yield* selectRoleMemberships(pg, name);
    return { ...row, memberOf };
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

export const buildGrantMembershipSql = (member: string, parent: string): string =>
  `GRANT ${quoteIdent(parent)} TO ${quoteIdent(member)}`;

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

/** Membership drift: sorted set difference between declared and live. Duplicates in the
 * declaration collapse to one; `undefined` means "not asserted" — nothing to grant or revoke. */
export const membershipDrift = (
  declared: readonly string[] | undefined,
  live: readonly string[],
): { readonly grants: readonly string[]; readonly revokes: readonly string[] } => {
  if (declared === undefined) return { grants: [], revokes: [] };
  const wanted = [...new Set(declared)].sort();
  const current = [...live].sort();
  return {
    grants: wanted.filter((parent) => !current.includes(parent)),
    revokes: current.filter((parent) => !wanted.includes(parent)),
  };
};
