/**
 * `Postgres.Role` — create / adopt / alter / drop of a LOGIN or NOLOGIN role on the same
 * self-hosted PostgreSQL 18 cluster `Postgres.Database` talks to, over the same transports
 * (runner `psql` or socket). The seat-wiring lane B12a's shape: one group role per seat
 * (NOLOGIN, member of `hf_agent`), plus the LOGIN seat users.
 *
 * ★ ALTER-CAPABLE, UNLIKE `Postgres.Database`. Every scalar this resource asserts has a safe
 *   atomic `ALTER ROLE` form (`LOGIN`/`NOLOGIN`, `INHERIT`/`NOINHERIT`, `CONNECTION LIMIT`,
 *   `VALID UNTIL` — `alter_role.sgml`'s first synopsis variant), so a drifted live row is
 *   brought back to the declaration, never refused. Memberships move through one-parent
 *   `GRANT`/`REVOKE` statements (`alter_role.sgml`: "there are no options for adding or
 *   removing memberships; use GRANT and REVOKE").
 * ⛔ THE PASSWORD IS A REFERENCE, NEVER A VALUE (S25). It is declared as
 *   `{ fromEnv: 'PG_SEAT_WIDGET_PASSWORD' }`; the NAME lands in state, the value is resolved
 *   from the deploying process's environment at reconcile time, held as `Redacted`, and sent only
 *   as the SCRAM-SHA-256 verifier inside the one `ALTER ROLE … PASSWORD` statement that needs it
 *   (`role-scram.ts` — the statement text reaching spans, `pg_stat_statements` and a failed
 *   `ALTER`'s server log never holds the plain value). What state remembers is a
 *   `scrypt:<salt>:<digest>` seal, so a reconcile sends the password only when the environment
 *   value differs from the one last written — a plan never re-sends a secret that already
 *   matches, and never stores one.
 * ★ MEMBERSHIP IS `pg_auth_members`, compared as a sorted set. `memberOf` omitted leaves live
 *   memberships alone; `[]` ensures none.
 * ★ `defaultRemovalPolicy: 'retain'` — a seat group role may own objects and be granted across
 *   databases; a destroy is still implemented in full (`DROP ROLE IF EXISTS`), opt in with
 *   `.pipe(RemovalPolicy.destroy())`. A role that still owns objects fails the drop with the
 *   server's own `2BP01` (`dependent_objects_still_exist`), surfaced as the client's `SqlError`.
 */
import { Resource } from 'alchemy';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import { type Environment } from '../secrets/write-only.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { nameByteRefusal, validUntilRefusal } from './role-attrs.ts';
import { passwordMatchesSeal, resolvePassword, sealPassword } from './role-secrets.ts';
import { scramSha256Verifier } from './role-scram.ts';
import {
  buildAlterRoleSql,
  buildCreateStatements,
  buildSetPasswordSql,
  privilegedFlags,
  readRoleWithClient,
  scalarDrift,
  storedAttributes,
} from './role-sql.ts';
import { assertParentsExist, syncMemberships } from './role-membership-sql.ts';
import {
  PostgresRoleCreateVanished,
  PostgresRoleIdentityRefused,
  type PostgresRoleMembershipUnrepaired,
  PostgresRoleNameRefused,
  type PostgresRoleParentMissing,
  PostgresRolePasswordEnvUnsetError,
  PostgresRolePrivilegedRefused,
  PostgresRoleValidUntilRefused,
} from './role-errors.ts';
import { type PostgresConnection } from './connection.ts';
import type { PgExecutor } from './database-sql.ts';

export interface PostgresRole extends Resource<
  'Postgres.Role',
  PostgresRoleProps,
  PostgresRoleAttributes,
  never,
  PostgresConnection
> {}

export const PostgresRole = Resource<PostgresRole>('Postgres.Role', {
  defaultRemovalPolicy: 'retain',
});

/** Mirrors `isPostgresDatabase`: a resource constructor is a callable `Object.assign`ed
 * function, not a plain object, so `typeof` must accept both. */
export const isPostgresRole = (value: unknown): value is PostgresRole =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Role';

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real client through `withPg`,
 * or `fake-sql.ts`'s recording fake in tests. `env` defaults to `process.env`; tests pass a
 * recording one. `previousSeal` is the seal in the engine's state — `''` when the role is
 * being written for the first time — because `pg_roles` answers no password (S25), so the live
 * row cannot say whether the environment value still matches the one last written.
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresRoleProps,
  env: Environment = process.env,
  previousSeal = '',
  storedOid?: number,
): Effect.Effect<
  PostgresRoleAttributes,
  | PostgresRolePasswordEnvUnsetError
  | PostgresRolePrivilegedRefused
  | PostgresRoleCreateVanished
  | PostgresRoleMembershipUnrepaired
  | PostgresRoleParentMissing
  | PostgresRoleIdentityRefused
  | SqlError
> =>
  Effect.gen(function* () {
    const resolved = resolvePassword(props, env);
    const observed = yield* readRoleWithClient(pg, props.name);
    if (observed === undefined) {
      // A create that declares a password must hold it: a LOGIN role with no password set, or
      // one created against a guess, is exactly the unauthenticated path to refuse.
      if (resolved.variable !== undefined && resolved.value === undefined) {
        return yield* Effect.fail(
          new PostgresRolePasswordEnvUnsetError({ role: props.name, variable: resolved.variable }),
        );
      }
      // The create carries no PASSWORD clause. The verifier ALTER and the seat GRANTs share
      // one transaction with the CREATE, so a failure rolls all of them back. A missing parent
      // is refused first — `GRANT` would otherwise be `42704` after the CREATE committed.
      yield* assertParentsExist(pg, props.name, props.memberOf);
      const verifier =
        resolved.value === undefined
          ? undefined
          : scramSha256Verifier(Redacted.value(resolved.value));
      yield* pg.transaction(buildCreateStatements(props, verifier));
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* readRoleWithClient(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresRoleCreateVanished({ role: props.name }));
      }
      return {
        ...storedAttributes(created),
        passwordSeal: resolved.value === undefined ? '' : sealPassword(resolved.value),
      };
    }
    // A recycled name (dropped and recreated out of band) is a different oid. Refuse before
    // any ALTER, PASSWORD or DROP-by-name the caller might follow with.
    if (storedOid !== undefined && observed.oid !== storedOid) {
      return yield* Effect.fail(
        new PostgresRoleIdentityRefused({
          role: props.name,
          storedOid,
          liveOid: observed.oid,
        }),
      );
    }
    // A live role this stack did not create can carry flags CREATE ROLE's default leaves off.
    // They are not inherited: SET ROLE to this role exercises them. Refuse before any write.
    const flags = privilegedFlags(observed);
    if (flags.length > 0) {
      return yield* Effect.fail(new PostgresRolePrivilegedRefused({ role: props.name, flags }));
    }
    // A declared password this stack has never sealed is not "do not churn". CREATE ROLE and
    // ALTER ROLE … PASSWORD are two statements; a retry after the second failed, or after the
    // process died before state was saved, sees the role and an empty seal. An unset variable
    // there must refuse — reporting success would leave a LOGIN role with a null password.
    if (resolved.variable !== undefined && resolved.value === undefined && previousSeal === '') {
      return yield* Effect.fail(
        new PostgresRolePasswordEnvUnsetError({ role: props.name, variable: resolved.variable }),
      );
    }
    // Parents before any ALTER, so a missing one does not leave a half-applied scalar update.
    yield* assertParentsExist(pg, props.name, props.memberOf);
    // Adopted or drifted: every scalar comes back to the declaration, one ALTER per field.
    for (const change of scalarDrift(props, observed)) {
      yield* pg.unsafe(buildAlterRoleSql(props.name, change)).pipe(Effect.asVoid);
    }
    // The password goes out only when it changed: the seal matches the last written value, or
    // the variable is unset here (a plan-only run must not churn a secret it cannot read). The
    // same match decides the seal that lands in state, so an unchanged password keeps the seal
    // it already had instead of being re-salted into a new one on every plan.
    const passwordMatched =
      resolved.value !== undefined && passwordMatchesSeal(resolved.value, previousSeal);
    if (resolved.value !== undefined && !passwordMatched) {
      yield* pg
        .unsafe(
          buildSetPasswordSql(props.name, scramSha256Verifier(Redacted.value(resolved.value))),
        )
        .pipe(Effect.asVoid);
    }
    yield* syncMemberships(pg, props, observed.memberships ?? []);
    const after = yield* readRoleWithClient(pg, props.name);
    if (after === undefined) {
      return yield* Effect.fail(new PostgresRoleCreateVanished({ role: props.name }));
    }
    return {
      ...storedAttributes(after),
      passwordSeal:
        resolved.value === undefined || passwordMatched
          ? previousSeal
          : sealPassword(resolved.value),
    };
  });

/** The core of `read`. Answers `undefined` when absent; ownership branding and the state-only
 * `passwordSeal` merge are the caller's. */
export const readRole = (pg: PgExecutor, name: string) => readRoleWithClient(pg, name);

/** Every plan-time refusal this family makes, in one place so `diff` and `reconcile` check the
 * same facts. Nothing here touches a client. */
export const refuseAtPlan = (
  props: PostgresRoleProps,
): Effect.Effect<void, PostgresRoleNameRefused | PostgresRoleValidUntilRefused> =>
  Effect.gen(function* () {
    const nameRefusal = nameByteRefusal(props.name);
    if (nameRefusal !== undefined) {
      return yield* Effect.fail(new PostgresRoleNameRefused({ name: props.name, ...nameRefusal }));
    }
    if (props.validUntil !== undefined) {
      const untilRefusal = validUntilRefusal(props.validUntil);
      if (untilRefusal !== undefined) {
        return yield* Effect.fail(
          new PostgresRoleValidUntilRefused({
            role: props.name,
            value: props.validUntil,
            reason: untilRefusal.reason,
          }),
        );
      }
    }
  });
