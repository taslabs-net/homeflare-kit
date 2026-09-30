/**
 * `Postgres.Grants` — one declarative grant set for one role in one schema of one database:
 * schema USAGE/CREATE, per-table privileges, per-column privileges, default privileges for
 * future tables per creator role, and an optional clear of PUBLIC. Computed as a diff
 * against the catalogs (`grants-read.ts`, through `aclexplode`), so a re-run with nothing
 * changed emits nothing, and drift on any NAMED object is repaired.
 *
 * ★ A GRANT SET CARRIES NO OWNERSHIP MARK (H1, same as `Postgres.Database`): `read` answers
 *   `Unowned` for a match, so already-live grants need `adopt(true)` in the stack that
 *   declares them.
 * ⛔ SCOPE IS EXACTLY THE DECLARATION. Objects the declaration does not name are never
 *   touched; removing a table from the declaration leaves its live grants alone (only
 *   `delete` revokes what the LAST declaration named). PUBLIC is only ever cleared, only
 *   when `revokeFromPublic: true`, and never re-granted.
 * ⛔ `delete` NEVER RE-GRANTS, NEVER CASCADES. The `retain` policy is the default; the
 *   revokes are idempotent; a third grantor's grant that a revoke cannot clear survives as
 *   a raw driver error (`REVOKE … CASCADE` is never issued).
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import type { PgExecutor } from './database-sql.ts';
import { roleExists } from './database-sql.ts';
import { type PgContext, type PostgresConnection, withPg } from './connection.ts';
import {
  type DeclarationRefusal,
  clearedDeclaration,
  declarationRefusal,
  declaredNames,
  grantsNamesRefusal,
  namesFromAttrs,
  resolveProps,
} from './grants-declare.ts';
import { attributesOf, grantsDiffer, planRepair } from './grants-plan.ts';
import { readGrants, schemaExists } from './grants-read.ts';
import {
  PostgresGrantsDatabaseMismatch,
  PostgresGrantsDuplicateObject,
  type PostgresGrantsError,
  PostgresGrantsNameRefused,
  PostgresGrantsPrivilegeRefused,
  PostgresGrantsRepairRefused,
  PostgresGrantsRetargetRefused,
  PostgresGrantsRoleMissing,
  PostgresGrantsSchemaMissing,
} from './grants-errors.ts';

export interface PostgresGrants extends Resource<
  'Postgres.Grants',
  PostgresGrantsProps,
  PostgresGrantsAttributes,
  never,
  PostgresConnection
> {}

export const PostgresGrants = Resource<PostgresGrants>('Postgres.Grants', {
  defaultRemovalPolicy: 'retain',
});

/** Same dual `typeof` guard as `isPostgresDatabase` (see `database.ts` for the measured
 * regression it exists to prevent). */
export const isPostgresGrants = (value: unknown): value is PostgresGrants =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Grants';

const failRefusal = (refusal: DeclarationRefusal) =>
  refusal.kind === 'privilege'
    ? Effect.fail(new PostgresGrantsPrivilegeRefused({ prop: refusal.prop, word: refusal.word }))
    : Effect.fail(new PostgresGrantsDuplicateObject({ prop: refusal.prop, name: refusal.name }));

const refuseNames = (props: PostgresGrantsProps) => {
  const declared = resolveProps(props);
  const names = grantsNamesRefusal(declared);
  return names === undefined
    ? undefined
    : new PostgresGrantsNameRefused({
        name: names.name,
        byteLength: names.byteLength,
        limit: names.limit,
      });
};

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real pooled client through
 * `withPg`, or the recording fake in tests. Validate the declaration (pure, before any
 * statement), check the containers exist, then repair: read, plan, execute, re-read,
 * re-plan — an EMPTY second plan is the convergence proof (S10: the write's own success
 * report is never trusted).
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresGrantsProps,
  context: PgContext,
): Effect.Effect<PostgresGrantsAttributes, PostgresGrantsError | SqlError> =>
  Effect.gen(function* () {
    const declared = resolveProps(props);
    const declRefusal = declarationRefusal(declared);
    if (declRefusal !== undefined) return yield* failRefusal(declRefusal);
    const nameRefusal = refuseNames(props);
    if (nameRefusal !== undefined) return yield* Effect.fail(nameRefusal);
    if (context.database !== declared.database) {
      return yield* Effect.fail(
        new PostgresGrantsDatabaseMismatch({
          declared: declared.database,
          connected: context.database,
        }),
      );
    }
    if (!(yield* schemaExists(pg, declared.schema))) {
      return yield* Effect.fail(new PostgresGrantsSchemaMissing({ schema: declared.schema }));
    }
    // The grantee and every default-privileges creator must exist BEFORE any statement:
    // the role a GRANT names is not missing-role-safe (unlike the aclexplode reads).
    for (const role of [declared.role, ...declared.defaults.map((entry) => entry.forRole)]) {
      if (!(yield* roleExists(pg, role))) {
        return yield* Effect.fail(new PostgresGrantsRoleMissing({ role }));
      }
    }
    const before = yield* readGrants(pg, declared.schema, declared.role);
    for (const statement of planRepair(declared, before)) {
      yield* pg.unsafe(statement).pipe(Effect.asVoid);
    }
    const after = yield* readGrants(pg, declared.schema, declared.role);
    const remaining = planRepair(declared, after);
    if (remaining.length > 0) {
      return yield* Effect.fail(
        new PostgresGrantsRepairRefused({
          schema: declared.schema,
          role: declared.role,
          remaining,
        }),
      );
    }
    return attributesOf(after, declaredNames(declared));
  });

/** The core of `read`: the recorded names (state file) or the last declaration's, projected
 * onto the live catalogs. `undefined` when the schema is absent; no role check — the
 * aclexplode reads are missing-role-safe by construction (`grants-read.ts`). */
export const readWithClient = (
  pg: PgExecutor,
  names: ReturnType<typeof namesFromAttrs>,
  context: PgContext,
): Effect.Effect<PostgresGrantsAttributes | undefined, PostgresGrantsDatabaseMismatch | SqlError> =>
  Effect.gen(function* () {
    if (context.database !== names.database) {
      return yield* Effect.fail(
        new PostgresGrantsDatabaseMismatch({
          declared: names.database,
          connected: context.database,
        }),
      );
    }
    if (!(yield* schemaExists(pg, names.schema))) return undefined;
    const live = yield* readGrants(pg, names.schema, names.role);
    return attributesOf(live, names);
  });

/** The core of `delete`: the cleared twin of the old declaration
 * (`grants-declare.ts#clearedDeclaration`), repaired against live — one revoke per named
 * object that still shows the role's words, nothing for PUBLIC, nothing for objects the
 * declaration never named. Idempotent: an already-revoked (or absent) object contributes no
 * statement, and a missing role or schema means nothing is left to revoke. */
export const deleteWithClient = (
  pg: PgExecutor,
  props: PostgresGrantsProps,
  context: PgContext,
): Effect.Effect<void, PostgresGrantsDatabaseMismatch | SqlError> =>
  Effect.gen(function* () {
    if (context.database !== props.database) {
      return yield* Effect.fail(
        new PostgresGrantsDatabaseMismatch({
          declared: props.database,
          connected: context.database,
        }),
      );
    }
    if (!(yield* roleExists(pg, props.role))) return;
    if (!(yield* schemaExists(pg, props.schema))) return;
    const cleared = clearedDeclaration(resolveProps(props));
    const live = yield* readGrants(pg, cleared.schema, cleared.role);
    for (const statement of planRepair(cleared, live)) {
      yield* pg.unsafe(statement).pipe(Effect.asVoid);
    }
  });

/** Plan-time only, entirely offline: a retarget of `role`/`database`/`schema` is a refusal
 * (those three name WHAT the grant set is about); everything else validates the same way
 * `reconcileWithClient` does, then answers `update` on any drift or `noop` on equality. */
export const diffPostgresGrants = (
  news: Input<PostgresGrantsProps>,
  output: PostgresGrantsAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const declared = resolveProps(news);
    for (const [prop, from, to] of [
      ['role', output.role, declared.role],
      ['database', output.database, declared.database],
      ['schema', output.schema, declared.schema],
    ] as const) {
      if (from !== to) {
        return yield* Effect.fail(new PostgresGrantsRetargetRefused({ prop, from, to }));
      }
    }
    const nameRefusal = refuseNames(news);
    if (nameRefusal !== undefined) return yield* Effect.fail(nameRefusal);
    const declRefusal = declarationRefusal(declared);
    if (declRefusal !== undefined) return yield* failRefusal(declRefusal);
    return grantsDiffer(declared, output)
      ? ({ action: 'update' } as const)
      : ({ action: 'noop' } as const);
  });

/** The five lifecycle handlers. Exported on its own so a test drives the real implementation
 * (see `database.ts` for why that matters). */
export const postgresGrantsHandlers = PostgresGrants.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP — the same reasoning as Postgres.Database's list: a sweep of
  //   every ACL row would enumerate grants nothing declared, across every role and schema.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const names =
        output !== undefined ? namesFromAttrs(output) : declaredNames(resolveProps(olds));
      const live = yield* withPg((pg, context) => readWithClient(pg, names, context));
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output }) => diffPostgresGrants(news, output),

  reconcile: ({ news }) => withPg((pg, context) => reconcileWithClient(pg, news, context)),

  delete: ({ olds }) => withPg((pg, context) => deleteWithClient(pg, olds, context)),
});

export const PostgresGrantsProvider = () =>
  Provider.succeed(PostgresGrants, postgresGrantsHandlers);
