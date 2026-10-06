/**
 * Membership statements and the catalog read behind them, split out of `role-sql.ts`
 * (file cap). One file so `diff`, reconcile and the fake agree on the exact texts.
 *
 * ★ ONE PARENT PER STATEMENT. `pg_auth_members` keys a membership on three columns —
 *   (parent, member, grantor) — so more than one row can exist for one parent name:
 *   another grantor's `ADMIN`-option grant rides beside the safe one. A multi-role
 *   `GRANT`/`REVOKE` list would make a partially-failed write harder to attribute.
 * ★ SEAT GRANTS SAY `SET FALSE`. Upstream `GRANT` defaults `SET` to TRUE (`grant.sgml` at
 *   REL_18_6), and `SET ROLE` to the parent is how `SUPERUSER` / `CREATEROLE` / `CREATEDB`
 *   are exercised (`user-manag.sgml`). A safe seat membership is `ADMIN FALSE, SET FALSE`.
 * ⛔ REVOKE BY GRANTOR. A plain `REVOKE parent FROM member` only touches rows the session's
 *   own grantor made; Postgres 18 warns and leaves another grantor's rows standing
 *   (`revoke.sgml`). Every revoke here names `GRANTED BY`. A mismatched grantor can still
 *   produce only a warning; the catalog re-read below catches surviving unsafe rows.
 */
import type { SqlError } from 'effect/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { quoteIdent, roleExists } from './database-sql.ts';
import { PostgresRoleMembershipUnrepaired, PostgresRoleParentMissing } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';

/** One `pg_auth_members` row as this family reads it: the parent name, the grantor who made
 * the grant, and the three options a name-only compare would hide. `admin` true is `WITH ADMIN`;
 * `inherit` true inherits the parent's privileges even when the member is NOINHERIT;
 * `set` true (the `GRANT` default) lets the member `SET ROLE` to the parent. `grantor` is null
 * only in an inconsistent catalog or a synthetic test row, not after an ordinary DROP ROLE:
 * PostgreSQL tracks grantor dependencies. Keep the null guard as a defensive refusal. */
export interface MembershipRow {
  readonly parent: string;
  readonly grantor: string | null;
  readonly admin: boolean;
  readonly set: boolean;
  readonly inherit: boolean;
}

const MEMBERSHIP_SQL = `SELECT parent.rolname AS parent,
    grantor.rolname AS grantor,
    m.admin_option AS admin,
    m.set_option AS set,
    m.inherit_option AS inherit
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles member ON member.oid = m.member
  JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
  LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid = m.grantor
  WHERE member.rolname = $1
  ORDER BY parent.rolname, grantor.rolname NULLS FIRST`;

export const selectRoleMemberships = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<readonly MembershipRow[], SqlError> =>
  Effect.map(pg.unsafe<MembershipRow>(MEMBERSHIP_SQL, [name]), (rows) => rows);

/** Seat grants say `SET FALSE`. Upstream `GRANT` defaults `SET` to TRUE, and `SET ROLE` to the
 * parent is how `SUPERUSER` / `CREATEROLE` / `CREATEDB` are exercised (`user-manag.sgml`). */
export const buildGrantMembershipSql = (member: string, parent: string): string =>
  `GRANT ${quoteIdent(parent)} TO ${quoteIdent(member)} WITH SET FALSE`;

/** ⛔ Do not repair with GRANT … ADMIN FALSE: measured in PR 336, that left grants made
 * by the member standing after stripping its ADMIN. PG 16+ tracks dependent role grants:
 * https://www.postgresql.org/docs/16/sql-grant.html#SQL-GRANT-DESCRIPTION-ROLES
 * https://www.postgresql.org/docs/16/sql-revoke.html
 * Measured 2026-10-02 on PG 17.11: REVOKE ADMIN OPTION … RESTRICT refuses dependents;
 * without dependents, ADMIN/SET revocation keeps membership and its INHERIT bit intact.
 * INHERIT revocation explicitly clears that bit for a declared NOINHERIT role.
 * GRANTED BY targets the observed row, including a different grantor's row. */
export const buildRepairMembershipSql = (
  member: string,
  parent: string,
  grantor: string,
  option: 'ADMIN' | 'SET' | 'INHERIT',
): string =>
  `REVOKE ${option} OPTION FOR ${quoteIdent(parent)} FROM ${quoteIdent(member)} GRANTED BY ${quoteIdent(grantor)} RESTRICT`;

/** Remove one grantor's row for one parent. Naming the grantor is what makes the revoke
 * bind: a plain `REVOKE` skips rows other grantors made (`revoke.sgml`). */
export const buildRevokeGrantorMembershipSql = (
  member: string,
  parent: string,
  grantor: string,
): string =>
  `REVOKE ${quoteIdent(parent)} FROM ${quoteIdent(member)} GRANTED BY ${quoteIdent(grantor)}`;

/** ADMIN/SET are always unsafe; per-grant INHERIT is unsafe for declared NOINHERIT.
 * PG 16–18 GRANT docs: the role attribute only defaults NEW membership grants. */
export const unsafeMemberships = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
  /** The DECLARED inherit flag (never the live one): a declared NOINHERIT role must see live
   *  per-grant INHERIT rows as unsafe even when the live role flag says INHERIT. */
  inherit: boolean,
): ReadonlySet<string> =>
  new Set(
    (live.memberships ?? [])
      .filter((row) => row.admin || row.set || (row.inherit && !inherit))
      .map((row) => row.parent),
  );

/** Membership drift: sorted set difference between declared and live. Duplicates in the
 * declaration collapse to one; `undefined` means "not asserted" — nothing to grant or revoke.
 * A parent already granted `WITH ADMIN`, or with `SET` still at the upstream default TRUE, is
 * a grant again: the name matches, but the options do not, so reconcile repairs in place. */
export const membershipDrift = (
  declared: readonly string[] | undefined,
  live: readonly string[],
  unsafe: ReadonlySet<string> = new Set(),
): { readonly grants: readonly string[]; readonly revokes: readonly string[] } => {
  if (declared === undefined) return { grants: [], revokes: [] };
  const wanted = [...new Set(declared)].sort();
  const current = [...new Set(live)].sort();
  return {
    grants: wanted.filter((parent) => !current.includes(parent) || unsafe.has(parent)),
    revokes: [
      ...current.filter((parent) => !wanted.includes(parent)),
      ...wanted.filter((parent) => current.includes(parent) && unsafe.has(parent)),
    ],
  };
};

/** Refuse before any membership write when a declared parent is not in `pg_roles`. `GRANT` of a
 * missing role is `42704` (`user.c@REL_18_6`), and on a create that error arrives only after
 * `CREATE ROLE` has committed. */
export const assertParentsExist = (
  pg: PgExecutor,
  role: string,
  parents: readonly string[] | undefined,
): Effect.Effect<void, PostgresRoleParentMissing | SqlError> =>
  Effect.gen(function* () {
    if (parents === undefined) return;
    for (const parent of [...new Set(parents)].sort()) {
      if (!(yield* roleExists(pg, parent))) {
        return yield* Effect.fail(new PostgresRoleParentMissing({ role, parent }));
      }
    }
  });

/** Make live memberships equal the declaration, preserving wanted memberships in place.
 * The previous full-options GRANT updated only its own grantor's row, then revoked other
 * unsafe rows; it could silently strip ADMIN despite dependent grants (PR 336 round 2).
 * Now each unsafe option is revoked by its observed grantor with RESTRICT. Unwanted rows
 * commit first, so a blocked ADMIN repair cannot restore unwanted access (PR 349 review).
 * Each retained row's options share a transaction, attributing a dependency/permission
 * refusal to that parent and grantor. No CASCADE and no replacement grantor row.
 * Unnameable grantors are defensive catalog-corruption cases, left to the typed backstop. */
export const syncMemberships = (
  pg: PgExecutor,
  props: PostgresRoleProps,
  rows: readonly MembershipRow[],
): Effect.Effect<
  readonly string[],
  SqlError | PostgresRoleMembershipUnrepaired | PostgresRoleParentMissing
> =>
  Effect.gen(function* () {
    if (props.memberOf === undefined) {
      return [...new Set(rows.map((row) => row.parent))].sort();
    }
    yield* assertParentsExist(pg, props.name, props.memberOf);
    const wanted = [...new Set(props.memberOf)].sort();
    const revokes: string[] = [];
    for (const row of rows) {
      if (!wanted.includes(row.parent) && row.grantor !== null) {
        revokes.push(buildRevokeGrantorMembershipSql(props.name, row.parent, row.grantor));
      }
    }
    if (revokes.length > 0) yield* pg.transaction(revokes);
    for (const row of rows) {
      if (row.grantor === null || !wanted.includes(row.parent)) continue;
      const statements: string[] = [];
      for (const option of ['ADMIN', 'SET', 'INHERIT'] as const) {
        const unsafe =
          option === 'ADMIN'
            ? row.admin
            : option === 'SET'
              ? row.set
              : row.inherit && !props.inherit;
        if (unsafe) {
          statements.push(buildRepairMembershipSql(props.name, row.parent, row.grantor, option));
        }
      }
      if (statements.length > 0)
        yield* pg.transaction(statements).pipe(
          Effect.catchTag('SqlError', (error) => {
            // Both installed socket and psql transports preserve raw SQLSTATE here.
            // Class 2B is UnknownError, class 42 is SqlSyntaxError; never match messages.
            const cause = error.reason.cause;
            const code =
              typeof cause === 'object' && cause !== null
                ? (cause as { code?: unknown }).code
                : undefined;
            return Effect.fail(
              code === '2BP01' || code === '42501'
                ? new PostgresRoleMembershipUnrepaired({
                    role: props.name,
                    parent: row.parent,
                    grantor: row.grantor,
                    declared: true,
                  })
                : error,
            );
          }),
        );
    }
    // Absent-but-wanted parents get a fresh seat grant. Existing rows keep their grantor.
    const grants = wanted
      .filter((p) => !rows.some((row) => row.parent === p))
      .map((parent) => buildGrantMembershipSql(props.name, parent));
    if (grants.length > 0) yield* pg.transaction(grants);
    // Backstop: anything not wanted or still unsafe fails typed.
    for (const row of yield* selectRoleMemberships(pg, props.name)) {
      if (!wanted.includes(row.parent) || row.admin || row.set || (row.inherit && !props.inherit)) {
        return yield* Effect.fail(
          new PostgresRoleMembershipUnrepaired({
            role: props.name,
            parent: row.parent,
            grantor: row.grantor,
            declared: wanted.includes(row.parent),
          }),
        );
      }
    }
    return wanted;
  });
