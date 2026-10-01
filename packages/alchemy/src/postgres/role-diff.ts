/**
 * Plan diff for `Postgres.Role`.
 *
 * ⛔ THE ENGINE PASSES STORED ATTRIBUTES, NOT A CATALOG READ. `Plan.ts` (alchemy beta.79,
 *   the `provider.diff` call that sets `output: oldState.attr`) hands `diff` whatever reconcile
 *   last stored. `storedAttributes` strips `memberships`, so a name-matched `memberOf` looks
 *   idle even when the live row is `WITH ADMIN` or still at the `SET TRUE` default. The provider
 *   reads the role and passes it as `observation`. Offline tests omit `observation` and compare
 *   the stored parent names only.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type { Environment } from '../secrets/write-only.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import {
  PostgresRoleIdentityRefused,
  type PostgresRoleNameRefused,
  PostgresRoleRenameRefused,
  type PostgresRoleValidUntilRefused,
} from './role-errors.ts';
import { membershipDrift, unsafeMemberships } from './role-membership-sql.ts';
import { passwordMatchesSeal, resolvePassword } from './role-secrets.ts';
import { scalarDrift } from './role-sql.ts';
import { refuseAtPlan } from './role.ts';

/** A catalog read the provider performed for this diff. `found: undefined` means the name is
 * absent. Omitting the argument means no catalog read (the offline comparison). */
export interface RoleObservation {
  readonly found: Omit<PostgresRoleAttributes, 'passwordSeal'> | undefined;
}

/**
 * `news` against stored `output`, plus a live row when the provider has one. A rename is a
 * plan-time refusal; so are an over-long name and an unusable `validUntil`. An oid that is not
 * the stored one is refused — the name was recreated out of band. Every other change answers
 * `update`. `delete` is a real drop here, so `diff` never answers `replace`.
 */
export const diffPostgresRole = (
  news: Input<PostgresRoleProps>,
  output: PostgresRoleAttributes | undefined,
  env: Environment = process.env,
  observation?: RoleObservation,
): Effect.Effect<
  { readonly action: 'update' } | { readonly action: 'noop' } | undefined,
  | PostgresRoleRenameRefused
  | PostgresRoleNameRefused
  | PostgresRoleValidUntilRefused
  | PostgresRoleIdentityRefused
> =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    if (news.name !== output.name) {
      return yield* Effect.fail(
        new PostgresRoleRenameRefused({ from: output.name, to: news.name }),
      );
    }
    yield* refuseAtPlan(news);
    const live = observation?.found;
    if (live !== undefined && live.oid !== output.oid) {
      return yield* Effect.fail(
        new PostgresRoleIdentityRefused({
          role: output.name,
          storedOid: output.oid,
          liveOid: live.oid,
        }),
      );
    }
    const compared = live ?? output;
    const scalars = scalarDrift(news, compared);
    // Option rows live only on the catalog read. Stored `memberships` is stripped before it
    // reaches the engine, so it is not consulted here.
    const membership = membershipDrift(
      news.memberOf,
      compared.memberOf ?? [],
      live === undefined ? new Set() : unsafeMemberships(live),
    );
    const resolved = resolvePassword(news, env);
    const passwordStale =
      resolved.value !== undefined && !passwordMatchesSeal(resolved.value, output.passwordSeal);
    const absent = observation !== undefined && live === undefined;
    const changed =
      absent ||
      scalars.length > 0 ||
      membership.grants.length > 0 ||
      membership.revokes.length > 0 ||
      passwordStale;
    return changed ? ({ action: 'update' } as const) : ({ action: 'noop' } as const);
  });
