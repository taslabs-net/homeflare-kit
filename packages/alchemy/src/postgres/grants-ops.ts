/**
 * The lifecycle cores of `Postgres.Grants`, against any `PgExecutor` — the real pooled
 * client through `withPg`, or the recording fake in tests: `reconcile`, `read`, `delete`
 * and the plan-time `diff`. The resource declaration and its doctrine header live in
 * `grants.ts`.
 *
 * ★ VALIDATE BEFORE ANY STATEMENT. The declaration refusals and the name-length check are
 *   pure and run first, then the container guards (schema in `pg_namespace`, the grantee
 *   role and every default-privileges creator in `pg_roles`), then — and only then — the
 *   repair's statements.
 * ★ `reconcile` CONVERGES BY PROOF, NOT TRUST (S10): read → plan → execute → re-read →
 *   re-plan; an EMPTY second plan is the success condition and a non-empty one fails loud
 *   with the surviving statements (`PostgresGrantsRepairRefused`).
 * ★ `output` (the last applied attributes) drives the two update-path repairs: the
 *   RETARGET guard (the plan-time one can be bypassed when `news` was unresolved at diff
 *   time — a role created in the same deploy) and the REMOVED-entries revoke set, run
 *   before the new declaration's plan and re-read after, because the server's `REVOKE ALL`
 *   on a table also clears that grantee's column entries on it.
 * ★ `read` answers `undefined` for a target that holds NOTHING anywhere and has no stored
 *   output: that is a first create, never an adoption of an empty schema (H1: only grants
 *   mark the target as live). On the update path — the resource already has applied state
 *   — an all-empty projection is a real answer (the grantee owns everything outright, so
 *   `aclexplode` has no rows) and is returned as the projection, not as absent. No role
 *   check — the aclexplode reads are missing-role-safe by construction (`grants-read.ts`).
 * ★ `delete` NEVER RE-GRANTS, NEVER CASCADES. The `retain` policy is the default; the
 *   revokes are idempotent; the delete then re-reads and re-plans like `reconcile` does
 *   (S10), so a third grantor's grant that a revoke cannot clear fails loud with the
 *   surviving statements (`PostgresGrantsRepairRefused`) instead of surviving silently
 *   (`REVOKE … CASCADE` is never issued).
 * ★ STATEMENTS RUN ONE COMMAND AT A TIME — NO WRAPPING TRANSACTION: the socket path's
 *   prepared-statement `unsafe` cannot carry several commands in one call and the psql
 *   runner is one process per statement, so a repair's revoke and grant are each their
 *   own autocommitted command. A live grantee briefly holds nothing between a pair's
 *   revoke and grant, and a mid-repair failure leaves the earlier revokes applied; the
 *   persisted declaration drives the next apply, which re-plans and heals.
 */
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { isResolved } from 'alchemy/Diff';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import { roleExists } from './database-sql.ts';
import type { PgExecutor } from './database-sql.ts';
import type { PgContext } from './connection.ts';
import type { namesFromAttrs } from './grants-declare.ts';
import { clearedDeclaration, declaredNames, removedNames, resolveProps } from './grants-declare.ts';
import {
  type DeclarationRefusal,
  declarationRefusal,
  grantsNamesRefusal,
} from './grants-refuse.ts';
import { attributesOf, grantsDiffer } from './grants-diff.ts';
import { planRepair, planRevocations } from './grants-plan.ts';
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

export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresGrantsProps,
  output: PostgresGrantsAttributes | undefined,
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
    for (const [prop, from, to] of [
      ['role', output?.role, declared.role],
      ['database', output?.database, declared.database],
      ['schema', output?.schema, declared.schema],
    ] as const) {
      if (from !== undefined && from !== to) {
        return yield* Effect.fail(new PostgresGrantsRetargetRefused({ prop, from, to }));
      }
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
    const removed = removedNames(output, declared);
    let current = yield* readGrants(pg, declared.schema, declared.role);
    if (removed !== undefined) {
      for (const statement of planRevocations(removed, current)) {
        yield* pg.unsafe(statement).pipe(Effect.asVoid);
      }
      current = yield* readGrants(pg, declared.schema, declared.role);
    }
    for (const statement of planRepair(declared, current)) {
      yield* pg.unsafe(statement).pipe(Effect.asVoid);
    }
    const after = yield* readGrants(pg, declared.schema, declared.role);
    const remaining = [
      ...(removed !== undefined ? planRevocations(removed, after) : []),
      ...planRepair(declared, after),
    ];
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

export const readWithClient = (
  pg: PgExecutor,
  names: ReturnType<typeof namesFromAttrs>,
  context: PgContext,
  stored: boolean,
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
    const projected = attributesOf(live, names);
    const holdsAnything =
      projected.schemaPrivileges.length > 0 ||
      projected.tables.some((table) => table.privileges.length > 0) ||
      projected.columns.some((column) => column.privileges.length > 0) ||
      projected.defaults.some((entry) => entry.privileges.length > 0);
    return stored || holdsAnything ? projected : undefined;
  });

export const deleteWithClient = (
  pg: PgExecutor,
  props: PostgresGrantsProps,
  context: PgContext,
): Effect.Effect<void, PostgresGrantsDatabaseMismatch | PostgresGrantsRepairRefused | SqlError> =>
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
    const after = yield* readGrants(pg, cleared.schema, cleared.role);
    const remaining = planRepair(cleared, after);
    if (remaining.length > 0) {
      return yield* Effect.fail(
        new PostgresGrantsRepairRefused({
          schema: cleared.schema,
          role: cleared.role,
          remaining,
        }),
      );
    }
  });

/** Plan-time only, entirely offline: a retarget of `role`/`database`/`schema` is a refusal
 * (those three name WHAT the grant set is about); everything else validates the same way
 * `reconcileWithClient` does, then answers `update` on any drift or `noop` on equality.
 * Unresolved news answers `undefined` (the engine falls back to its own comparison) — the
 * retarget is then re-checked inside `reconcile`, where news is resolved, so the bypass a
 * same-deploy role would otherwise get is closed. */
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
