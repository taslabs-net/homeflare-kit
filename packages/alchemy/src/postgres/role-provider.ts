/**
 * `Postgres.Role`'s five lifecycle handlers, wired to `withPg` for anything that touches a
 * client, and the one Layer a consuming stack provides. Split from `role.ts` so the file stays
 * under the house cap: `role.ts` holds the transport-agnostic cores (plan checks, reconcile,
 * diff, sync) that drive against any `PgExecutor`; this file holds only the engine wiring.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { refuseTakeover } from '../ownership/adopt.ts';
import { PostgresRole } from './role.ts';
import { diffPostgresRole, readRole, reconcileWithClient, refuseAtPlan } from './role.ts';
import { buildDropRoleSql } from './role-sql.ts';
import { withPg } from './connection.ts';

export const postgresRoleHandlers = PostgresRole.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP: `pg_roles` lists every role on the cluster, most of which nothing
  //   declared — the same reasoning `Postgres.Database`'s `list` documents.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const live = yield* withPg((pg) => readRole(pg, name));
      if (live === undefined) return undefined;
      // The seal is state-only (pg_roles answers no password), so the last written seal rides
      // back into the attributes the engine compares and stores.
      const passwordSeal = output?.passwordSeal ?? '';
      return output === undefined ? Unowned({ ...live, passwordSeal }) : { ...live, passwordSeal };
    }),

  diff: ({ news, output }) => diffPostgresRole(news, output),

  reconcile: ({ fqn, instanceId, news, output }) =>
    Effect.gen(function* () {
      yield* refuseAtPlan(news);
      return yield* withPg((pg) =>
        Effect.gen(function* () {
          // Alchemy skips the plan probe while a prop is still an Output, and a role can
          // appear between plan and apply. A live role with no state is a takeover: refuse
          // before any ALTER, PASSWORD or REVOKE, unless `--adopt` speaks for this apply.
          const observed = yield* readRole(pg, news.name);
          if (observed !== undefined && output === undefined) {
            yield* refuseTakeover({ fqn, instanceId, output }, 'Postgres.Role');
          }
          return yield* reconcileWithClient(pg, news, process.env, output?.passwordSeal);
        }),
      );
    }),

  delete: ({ olds }) => withPg((pg) => pg.unsafe(buildDropRoleSql(olds.name)).pipe(Effect.asVoid)),
});

export const PostgresRoleProvider = () => Provider.succeed(PostgresRole, postgresRoleHandlers);
