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
 *   (`revoke.sgml`). Every revoke here names `GRANTED BY`, so the statement either removes
 *   the row it targets or fails loudly — never a silent no-op.
 */
import type { SqlError } from 'effect/unstable/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { quoteIdent, roleExists } from './database-sql.ts';
import { PostgresRoleMembershipUnrepaired, PostgresRoleParentMissing } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';

/** One `pg_auth_members` row as this family reads it: the parent name, the grantor who made
 * the grant, and the two options a name-only compare would hide. `admin` true is `WITH ADMIN`;
 * `set` true (the `GRANT` default) lets the member `SET ROLE` to the parent. `grantor` is null
 * only in an inconsistent catalog or a synthetic test row, not after an ordinary DROP ROLE:
 * PostgreSQL tracks grantor dependencies. Keep the null guard as a defensive refusal. */
export interface MembershipRow {
  readonly parent: string;
  readonly grantor: string | null;
  readonly admin: boolean;
  readonly set: boolean;
}

const MEMBERSHIP_SQL = `SELECT parent.rolname AS parent,
    grantor.rolname AS grantor,
    m.admin_option AS admin,
    m.set_option AS set
  FROM pg_auth_members m
  JOIN pg_roles member ON member.oid = m.member
  JOIN pg_roles parent ON parent.oid = m.roleid
  LEFT JOIN pg_roles grantor ON grantor.oid = m.grantor
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
 * without dependents, option revocation keeps the membership and its INHERIT bit intact.
 * GRANTED BY targets the observed row, including a different grantor's row. */
export const buildRepairMembershipSql = (
  member: string,
  parent: string,
  grantor: string,
  option: 'ADMIN' | 'SET',
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

/** Catalog flags this family never declares. A create lands on the server default (all false);
 * an absent field on a seeded test row is that default. */
export const unsafeMemberships = (
  live: Omit<PostgresRoleAttributes, 'passwordSeal'>,
): ReadonlySet<string> =>
  new Set((live.memberships ?? []).filter((row) => row.admin || row.set).map((row) => row.parent));

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
 * Now each unsafe option is revoked by its observed grantor with RESTRICT. All membership
 * changes share a transaction: a dependency/permission failure rolls back the whole batch
 * and propagates the driver's typed SqlError. No CASCADE and no replacement grantor row.
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
    const statements: string[] = [];
    for (const row of rows) {
      if (row.grantor === null) continue;
      if (!wanted.includes(row.parent)) {
        statements.push(buildRevokeGrantorMembershipSql(props.name, row.parent, row.grantor));
      } else {
        for (const option of ['ADMIN', 'SET'] as const) {
          if (option === 'ADMIN' ? row.admin : row.set) {
            statements.push(buildRepairMembershipSql(props.name, row.parent, row.grantor, option));
          }
        }
      }
    }
    // Absent-but-wanted parents get a fresh seat grant. Existing rows keep their grantor.
    for (const parent of wanted.filter((p) => !rows.some((row) => row.parent === p))) {
      statements.push(buildGrantMembershipSql(props.name, parent));
    }
    if (statements.length > 0) yield* pg.transaction(statements);
    // Backstop: anything not wanted or still unsafe fails typed.
    for (const row of yield* selectRoleMemberships(pg, props.name)) {
      if (!wanted.includes(row.parent) || row.admin || row.set) {
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
