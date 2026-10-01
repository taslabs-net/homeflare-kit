/**
 * `Postgres.Role`'s five lifecycle handlers, wired to `withPg` for anything that touches a
 * client, and the one Layer a consuming stack provides. Split from `role.ts` so the file stays
 * under the house cap: `role.ts` holds reconcile, `role-diff.ts` the plan diff; this file holds
 * only the engine wiring.
 */
import * as Provider from 'alchemy/Provider';
import { isResolved } from 'alchemy/Diff';
import * as Effect from 'effect/Effect';
import { ownedRead } from '../ownership/probe.ts';
import { noteUnfinished } from '../ownership/resume.ts';
import { refuseTakeover } from '../ownership/adopt.ts';
import { PostgresRole } from './role.ts';
import { readRole, reconcileWithClient, refuseAtPlan } from './role.ts';
import { diffPostgresRole } from './role-diff.ts';
import { PostgresRoleIdentityRefused } from './role-errors.ts';
import { buildDropRoleSql, declarationMatches } from './role-sql.ts';
import { withPg } from './connection.ts';

export const postgresRoleHandlers = PostgresRole.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP: `pg_roles` lists every role on the cluster, most of which nothing
  //   declared — the same reasoning `Postgres.Database`'s `list` documents.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ fqn, instanceId, olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const live = yield* withPg((pg) => readRole(pg, name));
      if (live === undefined) return undefined;
      // A recycled name is not the role state recorded. Failing (rather than `Unowned`) matters
      // because drift strips `Unowned` and would then reconcile the foreign role.
      if (output !== undefined && live.oid !== output.oid) {
        return yield* Effect.fail(
          new PostgresRoleIdentityRefused({
            role: name,
            storedOid: output.oid,
            liveOid: live.oid,
          }),
        );
      }
      const passwordSeal = output?.passwordSeal ?? '';
      const found = { ...live, passwordSeal };
      return yield* ownedRead(
        { fqn, instanceId, output },
        found,
        Effect.succeed(declarationMatches(olds, live)),
      );
    }),

  diff: ({ news, output, instanceId }) =>
    Effect.gen(function* () {
      // A `creating` row has no attributes. Mark it unfinished so `--adopt` can resume it
      // (ownership/resume.ts); the engine treats `undefined` as "defer".
      if (output === undefined) return yield* noteUnfinished(instanceId);
      if (!isResolved(news)) return undefined;
      const found = yield* withPg((pg) => readRole(pg, output.name));
      return yield* diffPostgresRole(news, output, process.env, { found });
    }),

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
          return yield* reconcileWithClient(
            pg,
            news,
            process.env,
            output?.passwordSeal,
            output?.oid,
          );
        }),
      );
    }),

  delete: ({ output }) =>
    withPg((pg) =>
      Effect.gen(function* () {
        if (output === undefined) return;
        const live = yield* readRole(pg, output.name);
        if (live === undefined) return;
        if (live.oid !== output.oid) {
          return yield* Effect.fail(
            new PostgresRoleIdentityRefused({
              role: output.name,
              storedOid: output.oid,
              liveOid: live.oid,
            }),
          );
        }
        yield* pg.unsafe(buildDropRoleSql(output.name)).pipe(Effect.asVoid);
      }),
    ),
});

export const PostgresRoleProvider = () => Provider.succeed(PostgresRole, postgresRoleHandlers);
