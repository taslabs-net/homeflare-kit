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
 *   from the deploying process's environment at reconcile time, held as `Redacted`, and quoted
 *   into the one `ALTER ROLE … PASSWORD` statement that needs it. What state remembers is a
 *   `scrypt:<salt>:<digest>` seal, so a reconcile sends the password only when the environment
 *   value differs from the one last written — a plan never re-sends a secret that already
 *   matches, and never stores one.
 * ★ MEMBERSHIP IS `pg_auth_members`, compared as a sorted set. `memberOf` omitted leaves live
 *   memberships alone; `[]` ensures none.
 * ★ `defaultRemovalPolicy: 'retain'` — a seat group role may own objects and be granted across
 *   databases; a destroy is still implemented in full (`DROP ROLE IF EXISTS`), opt in with
 *   `.pipe(RemovalPolicy.destroy())`. A role that still owns objects fails the drop with the
 *   server's own `2B01`, surfaced as the client's `SqlError`.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import { type Environment } from '../secrets/write-only.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { nameByteRefusal, validUntilRefusal } from './role-attrs.ts';
import { passwordMatchesSeal, resolvePassword, sealPassword } from './role-secrets.ts';
import {
  buildAlterRoleSql,
  buildCreateRoleSql,
  buildGrantMembershipSql,
  buildRevokeMembershipSql,
  buildSetPasswordSql,
  membershipDrift,
  readRoleWithClient,
  scalarDrift,
} from './role-sql.ts';
import {
  PostgresRoleCreateVanished,
  PostgresRoleNameRefused,
  PostgresRolePasswordEnvUnsetError,
  PostgresRoleRenameRefused,
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
): Effect.Effect<
  PostgresRoleAttributes,
  PostgresRolePasswordEnvUnsetError | PostgresRoleCreateVanished | SqlError
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
      // The create carries no PASSWORD clause, so a credential never rides a CREATE's log line;
      // the one secret statement is the dedicated ALTER below. `syncMemberships` against an
      // empty live set grants every declared parent — a `GRANT` naming an absent parent role
      // fails with the server's own clear error, carried as the client's `SqlError`.
      yield* pg.unsafe(buildCreateRoleSql(props)).pipe(Effect.asVoid);
      if (resolved.value !== undefined) {
        yield* pg
          .unsafe(buildSetPasswordSql(props.name, Redacted.value(resolved.value)))
          .pipe(Effect.asVoid);
      }
      yield* syncMemberships(pg, props, []);
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* readRoleWithClient(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresRoleCreateVanished({ role: props.name }));
      }
      return {
        ...created,
        passwordSeal: resolved.value === undefined ? '' : sealPassword(resolved.value),
      };
    }
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
        .unsafe(buildSetPasswordSql(props.name, Redacted.value(resolved.value)))
        .pipe(Effect.asVoid);
    }
    yield* syncMemberships(pg, props, observed.memberOf ?? []);
    const after = yield* readRoleWithClient(pg, props.name);
    if (after === undefined) {
      return yield* Effect.fail(new PostgresRoleCreateVanished({ role: props.name }));
    }
    return {
      ...after,
      passwordSeal:
        resolved.value === undefined || passwordMatched
          ? previousSeal
          : sealPassword(resolved.value),
    };
  });

/** Grant what the declaration wants and revoke what it does not. `undefined` leaves live alone;
 * answers the declared set (sorted, de-duplicated), or the live set when nothing was declared. */
export const syncMemberships = (
  pg: PgExecutor,
  props: PostgresRoleProps,
  live: readonly string[],
): Effect.Effect<readonly string[], SqlError> =>
  Effect.gen(function* () {
    const { grants, revokes } = membershipDrift(props.memberOf, live);
    for (const parent of grants) {
      yield* pg.unsafe(buildGrantMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    for (const parent of revokes) {
      yield* pg.unsafe(buildRevokeMembershipSql(props.name, parent)).pipe(Effect.asVoid);
    }
    return props.memberOf === undefined ? live : [...new Set(props.memberOf)].sort();
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

/**
 * The core of `diff`: `news` against `output`, plus one in-process read of the environment to
 * notice a rotated password (the seal lives in state, so the live cluster cannot say). A rename
 * is a plan-time refusal; so are an over-long name and an unusable `validUntil`; every other
 * change answers `update`. `delete` is a real drop here, so `diff` never answers `replace`.
 */
export const diffPostgresRole = (
  news: Input<PostgresRoleProps>,
  output: PostgresRoleAttributes | undefined,
  env: Environment = process.env,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    if (news.name !== output.name) {
      return yield* Effect.fail(
        new PostgresRoleRenameRefused({ from: output.name, to: news.name }),
      );
    }
    yield* refuseAtPlan(news);
    const scalars = scalarDrift(news, output);
    const membership = membershipDrift(news.memberOf, output.memberOf ?? []);
    // The seal is state-only, so diff is the only place a rotated environment value is noticed:
    // a resolved password that no longer matches the seal answers `update`, the same
    // staleness rule LiteLLM.MCPServer's `credentialState` applies. An unset variable is never
    // stale — a plan that cannot read the secret never churns it.
    const resolved = resolvePassword(news, env);
    const passwordStale =
      resolved.value !== undefined && !passwordMatchesSeal(resolved.value, output.passwordSeal);
    const changed =
      scalars.length > 0 ||
      membership.grants.length > 0 ||
      membership.revokes.length > 0 ||
      passwordStale;
    return changed ? ({ action: 'update' } as const) : ({ action: 'noop' } as const);
  });
