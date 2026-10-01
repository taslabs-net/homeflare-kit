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
 * when the granting role was later dropped — such a row can never be named in a `REVOKE …
 * GRANTED BY`, so it can only be repaired by hand as a bootstrap superuser. */
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

/** Repair an existing membership in place: one atomic full-options `GRANT` per parent.
 * Upstream keeps any `WITH` option the new `GRANT` omits (`grant.sgml`), so a repair must
 * spell both bits — `ADMIN FALSE, SET FALSE` — rather than rely on `SET FALSE` alone. */
export const buildRepairMembershipSql = (member: string, parent: string): string =>
  `GRANT ${quoteIdent(parent)} TO ${quoteIdent(member)} WITH ADMIN FALSE, SET FALSE`;

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

/** Make live memberships equal the declaration, never dropping a membership the declaration
 * keeps. A wanted parent that is already granted is repaired with one
 * `GRANT … WITH ADMIN FALSE, SET FALSE` — `AddRoleMems` updates that grantor's row in place
 * (`user.c@REL_18_6` `SearchSysCache3` on role, member, grantor) — and any other grantor's
 * unsafe row is then revoked by name.
 *
 * 1. Rows the declaration does not want are revoked **by their own grantor** (dead-grantor
 *    rows are skipped and left for the backstop to report).
 * 2. Unsafe-but-wanted rows get one full-options repair `GRANT` per parent — atomic, in place,
 *    so the membership never drops even when another grantor's row also exists.
 * 3. A repair leaves other grantors' unsafe rows beside the safe one, so a mid re-read
 *    revokes every remaining unsafe row with a live grantor.
 * 4. Absent-but-wanted parents get a fresh seat grant.
 * 5. Backstop re-read: any row that is not wanted, or still unsafe, fails typed — including a
 *    dead-grantor row, which no statement this family may issue can repair. */
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
    // 1. Not-wanted rows: revoke each by its own grantor (dead-grantor rows skipped; the
    //    backstop catches them).
    for (const row of rows) {
      if (wanted.includes(row.parent) || row.grantor === null) continue;
      yield* pg
        .unsafe(buildRevokeGrantorMembershipSql(props.name, row.parent, row.grantor))
        .pipe(Effect.asVoid);
    }
    // 2. Unsafe-but-wanted rows: one full-options repair `GRANT` per parent.
    const repaired = [
      ...new Set(
        rows
          .filter(
            (row) => wanted.includes(row.parent) && (row.admin || row.set) && row.grantor !== null,
          )
          .map((row) => row.parent),
      ),
    ];
    for (const parent of repaired) {
      yield* pg.unsafe(buildRepairMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    // 3. If any repair ran, other grantors' unsafe rows may still stand: re-read and revoke
    //    them by grantor (the repair's own safe row remains).
    if (repaired.length > 0) {
      const midRead = yield* selectRoleMemberships(pg, props.name);
      for (const row of midRead) {
        if (wanted.includes(row.parent) && (row.admin || row.set) && row.grantor !== null) {
          yield* pg
            .unsafe(buildRevokeGrantorMembershipSql(props.name, row.parent, row.grantor))
            .pipe(Effect.asVoid);
        }
      }
    }
    // 4. Absent-but-wanted parents: fresh seat grant.
    for (const parent of wanted.filter((p) => !rows.some((row) => row.parent === p))) {
      yield* pg.unsafe(buildGrantMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    // 5. Backstop: anything not wanted or still unsafe fails typed.
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
