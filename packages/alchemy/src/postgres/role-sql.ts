/**
 * The statements `Postgres.Role` ever issues, and the one read that backs them.
 *
 * ⛔ `CREATE ROLE` / `ALTER ROLE` TAKE NO BIND PARAMETERS FOR ANY OF THEIR VALUES. Measured at
 *   `gram.y@REL_18_6`: every option value in `CreateOptRoleStmt` is a `RoleSpec`, a signed
 *   `Iconst` or an `Sconst`, and none of those productions reaches `PARAM` (`$n`). Only the
 *   catalog reads below bind a role name (`$1`).
 * ⛔ THE PASSWORD NEVER CROSSES THE WIRE AS A PLAIN LITERAL. Postgres has no bind form for it in
 *   `CREATE`/`ALTER ROLE`, so the statement carries the SCRAM-SHA-256 verifier `role-scram.ts`
 *   computes client-side (what `psql \password` sends; stored as-is, never reversible): the
 *   statement text that reaches the span attribute `db.query.text`, `pg_stat_statements` and a
 *   failed `ALTER`'s server log holds no secret. It is quoted with `quoteStringLiteral` like every
 *   other string value and NEVER written to state — only its seal is (`role-attrs.ts`,
 *   `passwordSeal`).
 * ★ MEMBERSHIP IS TWO ONE-PARENT STATEMENTS (`GRANT` / `REVOKE`), never a multi-role list, so a
 *   partially-failed membership write is observable in the state that remains. Those statements
 *   and the `pg_auth_members` read live in `role-membership-sql.ts` — this file stays the role
 *   row (`pg_roles`), its scalar statements and the compare between them.
 */
import type { SqlError } from 'effect/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { quoteIdent, quoteStringLiteral } from './database-sql.ts';
import { buildGrantMembershipSql, selectRoleMemberships } from './role-membership-sql.ts';
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
  FROM pg_catalog.pg_roles r
  WHERE r.rolname = $1`;

export const selectRole = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<Omit<PostgresRoleAttributes, 'memberOf' | 'passwordSeal'> | undefined, SqlError> =>
  Effect.map(
    pg.unsafe<Omit<PostgresRoleAttributes, 'memberOf' | 'passwordSeal'>>(SELECT_ROLE_SQL, [name]),
    (rows) => rows[0],
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
    const memberships = yield* selectRoleMemberships(pg, name);
    // Two grantors of one parent are two catalog rows. `memberOf` is the set of names.
    return {
      ...row,
      memberOf: [...new Set(memberships.map((membership) => membership.parent))].sort(),
      memberships,
    };
  });

/** The `WITH` options a create carries, in one place so `diff` and the fake agree on the text.
 * A create carries no PASSWORD clause — the password travels through
 * {@link buildSetPasswordSql} as its SCRAM verifier, so the one quoting path is exercised exactly
 * once and a `CREATE ROLE` never carries a credential in its log line. */
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

/** One dedicated `ALTER ROLE … PASSWORD`. It carries the SCRAM-SHA-256 verifier
 * `role-scram.ts` computes, never the plain password: Postgres takes no bind parameter for a role
 * password, but a string already in SCRAM verifier format is stored as-is (`create_role.sgml`),
 * so the statement text that reaches the span, `pg_stat_statements` and a failed `ALTER`'s server
 * log holds no secret. */
export const buildSetPasswordSql = (name: string, verifier: string): string =>
  `ALTER ROLE ${quoteIdent(name)} WITH PASSWORD ${quoteStringLiteral(verifier)}`;

export const buildDropRoleSql = (name: string): string => `DROP ROLE IF EXISTS ${quoteIdent(name)}`;

/** `CREATE`, the optional password `ALTER`, and one seat `GRANT` per declared parent, in the
 * order a single transaction runs them. Grants are sorted so the script is stable. */
export const buildCreateStatements = (
  props: PostgresRoleProps,
  verifier: string | undefined,
): readonly string[] => [
  buildCreateRoleSql(props),
  ...(verifier === undefined ? [] : [buildSetPasswordSql(props.name, verifier)]),
  ...[...new Set(props.memberOf ?? [])]
    .sort()
    .map((parent) => buildGrantMembershipSql(props.name, parent)),
];

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

/** Whether a live role is the one an interrupted create would have left: every declared scalar,
 * the declared parent set, and no privilege flag or unsafe membership option. The password is
 * not in `pg_roles`, so it is not part of the proof. */
export const declarationMatches = (
  props: PostgresRoleProps,
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): boolean => {
  const wanted =
    props.memberOf === undefined ? undefined : [...new Set(props.memberOf)].sort().join('\0');
  const found = [...(live.memberOf ?? [])].sort().join('\0');
  return (
    props.name === live.name &&
    props.login === live.login &&
    props.inherit === live.inherit &&
    props.connectionLimit === live.connectionLimit &&
    (props.validUntil === undefined || sameValidUntil(props.validUntil, live.validUntil)) &&
    (wanted === undefined || wanted === found) &&
    privilegedFlags(live).length === 0 &&
    (live.memberships ?? []).every(
      (row) => !row.admin && !row.set && (!row.inherit || props.inherit),
    )
  );
};

/** Drop the observe-only membership options before attributes reach state. Alchemy's plan diff
 * receives the stored attributes (`Plan.ts` passes `oldState.attr`), so an `admin`/`set` row
 * kept here would still not be what `diff` sees — the provider reads `pg_auth_members` live.
 * What state stores is the parent-name set. */
export const storedAttributes = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): Omit<PostgresRoleAttributes, 'passwordSeal'> => {
  const { memberships: _observeOnly, ...stored } = live;
  return stored;
};

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
