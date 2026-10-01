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
 * ★ `delete` NEVER RE-GRANTS THE DECLARATION, NEVER CASCADES. The `retain` policy is the
 *   default; the revokes are idempotent; the delete then re-reads and re-plans like
 *   `reconcile` does (S10), so a third grantor's grant that a revoke cannot clear fails loud
 *   with the surviving statements (`PostgresGrantsRepairRefused`) instead of surviving
 *   silently (`REVOKE … CASCADE` is never issued). The one re-grant a delete still makes is
 *   the collateral a table `REVOKE ALL` clears on columns the declaration never named (a
 *   DBA's or another Grants resource's column grant): `planRepair` restores those as it does
 *   on the reconcile path (`grants.ts:17-18`, `grants-plan.ts:12-14`), so a delete takes
 *   away what the declaration managed and leaves everything else exactly as it was.
 * ★ THE REPAIR'S WRITES ARE ONE TRANSACTION. `unsafe` is still one command — the socket
 *   path's prepared statement cannot carry several, and each psql `unsafe` is its own
 *   process — but `pg.transaction` is `BEGIN`…`COMMIT` on both transports (one reserved
 *   connection on the socket, one psql script on the runner; `psql-executor.ts`). GRANT
 *   and REVOKE do not call `PreventInTransactionBlock` (`database-sql.ts` cites the same
 *   rule for role membership). Removal revokes and the repair are planned together
 *   against one read (`planReconcile`: removed tables count as revoked) and committed
 *   together, so a live grantee never observes the gap between a `REVOKE ALL` and the
 *   grants that restore it. The convergence re-read runs after that commit.
 */
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { isResolved } from 'alchemy/Diff';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import { roleExists } from './database-sql.ts';
import type { PgExecutor } from './database-sql.ts';
import { currentDatabase } from './schema-sql.ts';
import type { namesFromAttrs } from './grants-declare.ts';
import { clearedDeclaration, declaredNames, removedNames, resolveProps } from './grants-declare.ts';
import {
  type DeclarationRefusal,
  declarationRefusal,
  grantsNamesRefusal,
} from './grants-refuse.ts';
import { attributesOf, grantsDiffer } from './grants-diff.ts';
import { requireDeclaredObjectsExist } from './grants-existence.ts';
import { planReconcile, planRepair } from './grants-plan.ts';
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

/** The handlers open the declared database; this proves the session landed there.
 * `current_database()` is the server's answer, not the override we asked `withPg` for. */
const proveDatabase = (
  pg: PgExecutor,
  declared: string,
): Effect.Effect<void, PostgresGrantsDatabaseMismatch | SqlError> =>
  Effect.flatMap(currentDatabase(pg), (connected) =>
    connected === declared
      ? Effect.void
      : Effect.fail(new PostgresGrantsDatabaseMismatch({ declared, connected })),
  );

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
): Effect.Effect<PostgresGrantsAttributes, PostgresGrantsError | SqlError> =>
  Effect.gen(function* () {
    const declared = resolveProps(props);
    const declRefusal = declarationRefusal(declared);
    if (declRefusal !== undefined) return yield* failRefusal(declRefusal);
    const nameRefusal = refuseNames(props);
    if (nameRefusal !== undefined) return yield* Effect.fail(nameRefusal);
    for (const [prop, from, to] of [
      ['role', output?.role, declared.role],
      ['database', output?.database, declared.database],
      ['schema', output?.schema, declared.schema],
    ] as const) {
      if (from !== undefined && from !== to) {
        return yield* Effect.fail(new PostgresGrantsRetargetRefused({ prop, from, to }));
      }
    }
    yield* proveDatabase(pg, declared.database);
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
    // Declared relations and columns must exist before any statement: a GRANT/REVOKE on a
    // missing object would fail raw after earlier statements had already landed, leaving
    // the state row `creating` and the resume failing OwnedBySomeoneElse.
    yield* requireDeclaredObjectsExist(pg, declared);
    const removed = removedNames(output, declared);
    const current = yield* readGrants(pg, declared.schema, declared.role);
    const planned = planReconcile(declared, current, removed);
    if (planned.length > 0) yield* pg.transaction(planned);
    const after = yield* readGrants(pg, declared.schema, declared.role);
    const remaining = planReconcile(declared, after, removed);
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
  stored: boolean,
): Effect.Effect<PostgresGrantsAttributes | undefined, PostgresGrantsDatabaseMismatch | SqlError> =>
  Effect.gen(function* () {
    yield* proveDatabase(pg, names.database);
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
): Effect.Effect<void, PostgresGrantsDatabaseMismatch | PostgresGrantsRepairRefused | SqlError> =>
  Effect.gen(function* () {
    yield* proveDatabase(pg, props.database);
    if (!(yield* roleExists(pg, props.role))) return;
    if (!(yield* schemaExists(pg, props.schema))) return;
    const cleared = clearedDeclaration(resolveProps(props));
    const live = yield* readGrants(pg, cleared.schema, cleared.role);
    const planned = planRepair(cleared, live);
    if (planned.length > 0) yield* pg.transaction(planned);
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
