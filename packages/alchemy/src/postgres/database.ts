/**
 * `Postgres.Database` — create-and-assert over a self-hosted PostgreSQL 18 cluster.
 *
 * ⛔ THIS IS NOT AN ALTER-CAPABLE RESOURCE. Every optional prop is asserted ONCE, at create, and
 *   compared against the live row on every later plan; a mismatch is a typed
 *   `PostgresDatabaseDrift` refusal, never an `ALTER DATABASE`. `docs/postgres.md` says why:
 *   several of these props (`LC_COLLATE`, `LC_CTYPE`, `LOCALE_PROVIDER`) cannot be altered on a
 *   live database at all without `ALTER … REFRESH COLLATION VERSION` semantics this family does
 *   not implement, and the rest are left alone on principle rather than by accident.
 * ⛔ `delete` NEVER DROPS. See `errors.ts#PostgresDatabaseDropRefused` and
 *   `defaultRemovalPolicy: 'retain'` below — two independent reasons the engine never issues
 *   `DROP DATABASE` through this provider.
 * ★ A DATABASE CARRIES NO OWNERSHIP MARK (H1). `read` always answers `Unowned` for a match, the
 *   same rule `Cloudflare.Snippets.Snippet` uses for a marker-less API — so every one of the
 *   mini's 19 already-live databases needs `adopt(true)` in the stack that declares it.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PostgresDatabaseAttributes, PostgresDatabaseProps } from './database-attrs.ts';
import { nameByteRefusal } from './database-attrs.ts';
import {
  buildCreateDatabaseSql,
  firstDrift,
  isDuplicateDatabaseRace,
  roleExists,
  selectDatabase,
} from './database-sql.ts';
import { type PostgresConnection, withPg } from './connection.ts';
import type { PgExecutor } from './database-sql.ts';
import {
  PostgresDatabaseCreateVanished,
  PostgresDatabaseDrift,
  PostgresDatabaseDropRefused,
  PostgresDatabaseNameRefused,
  PostgresDatabaseOwnerMissing,
  PostgresDatabaseRenameRefused,
} from './errors.ts';

export interface PostgresDatabase extends Resource<
  'Postgres.Database',
  PostgresDatabaseProps,
  PostgresDatabaseAttributes,
  never,
  PostgresConnection
> {}

export const PostgresDatabase = Resource<PostgresDatabase>('Postgres.Database', {
  defaultRemovalPolicy: 'retain',
});

/** Mirrors `alchemy/Resource`'s own `isResourceOfType`: a resource constructor is a callable
 * `Object.assign`ed function, not a plain object, so `typeof` must accept both — a bare
 * `'object'` check (measured live in `scripts/smoke.ts`: it rejects `PostgresDatabase` itself,
 * matching only an instance) is the regression this comment exists to prevent. */
export const isPostgresDatabase = (value: unknown): value is PostgresDatabase =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Database';

/** Every asserted-prop mismatch against the LIVE row, owner included — reconcile's own
 * authoritative check, independent of what `diff` compared at plan time (S10: cloud state is
 * authoritative). */
const liveDrift = (props: PostgresDatabaseProps, live: PostgresDatabaseAttributes) => {
  if (props.owner !== live.owner) {
    return { prop: 'owner', declared: props.owner, live: live.owner };
  }
  return firstDrift(props, live);
};

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real pooled client through
 * `withPg`, or `fake-sql.ts`'s recording fake in tests. Kept apart from the provider wiring
 * below so a lifecycle test drives this exact function, not a re-implementation of it.
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresDatabaseProps,
): Effect.Effect<
  PostgresDatabaseAttributes,
  PostgresDatabaseOwnerMissing | PostgresDatabaseDrift | PostgresDatabaseCreateVanished | SqlError
> =>
  Effect.gen(function* () {
    const observed = yield* selectDatabase(pg, props.name);
    if (observed === undefined) {
      const ownerPresent = yield* roleExists(pg, props.owner);
      if (!ownerPresent) {
        return yield* Effect.fail(
          new PostgresDatabaseOwnerMissing({ database: props.name, owner: props.owner }),
        );
      }
      yield* pg.unsafe(buildCreateDatabaseSql(props)).pipe(
        Effect.asVoid,
        Effect.catchTag('SqlError', (error) =>
          isDuplicateDatabaseRace(error) ? Effect.succeed(undefined) : Effect.fail(error),
        ),
      );
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* selectDatabase(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresDatabaseCreateVanished({ database: props.name }));
      }
      return created;
    }
    const drift = liveDrift(props, observed);
    if (drift !== undefined) {
      return yield* Effect.fail(
        new PostgresDatabaseDrift({
          database: props.name,
          prop: drift.prop,
          declared: drift.declared,
          live: drift.live,
        }),
      );
    }
    // Unchanged: the row already read is the authoritative answer. No write, no second round trip.
    return observed;
  });

/** The core of `read`: one bound `SELECT`, no ownership branding — the caller (the provider's
 * `read` below, or a test) decides whether to wrap a match in `Unowned`. */
export const readWithClient = (pg: PgExecutor, name: string) => selectDatabase(pg, name);

/**
 * The core of `diff`, entirely offline: `news` (declared) against `output` (last-applied
 * attributes) — never a live query (that authoritative check is `reconcileWithClient`'s job, per
 * S10). A rename is a plan-time refusal; over-long names are too, so a bad name never even reaches
 * `reconcile`; every other change answers `update`, which `reconcileWithClient` then either
 * applies (create) or refuses (drift on an already-live database).
 */
export const diffPostgresDatabase = (
  news: Input<PostgresDatabaseProps>,
  output: PostgresDatabaseAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    if (news.name !== output.name) {
      return yield* Effect.fail(
        new PostgresDatabaseRenameRefused({ from: output.name, to: news.name }),
      );
    }
    const nameRefusal = nameByteRefusal(news.name);
    if (nameRefusal !== undefined) {
      return yield* Effect.fail(
        new PostgresDatabaseNameRefused({ name: news.name, ...nameRefusal }),
      );
    }
    const changed = news.owner !== output.owner || firstDrift(news, output) !== undefined;
    return changed ? ({ action: 'update' } as const) : ({ action: 'noop' } as const);
  });

/**
 * The five lifecycle handlers, wired to `withPg` for anything that touches a client. Exported
 * on its own — not only through {@link PostgresDatabaseProvider}'s `Layer` — so a test can call
 * `postgresDatabaseHandlers.delete(...)` directly, against the real implementation, without
 * standing up the engine's provider machinery.
 */
export const postgresDatabaseHandlers = PostgresDatabase.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP. Enumerating `pg_database` would list every database on the
  //   cluster, most of which nothing declared — the same reasoning `NetboxPrefix` documents
  //   for its own marker-less `list`. Adoption for this family is one declaration at a time.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const live = yield* withPg((pg) => readWithClient(pg, name));
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output }) => diffPostgresDatabase(news, output),

  reconcile: ({ news }) =>
    Effect.gen(function* () {
      const nameRefusal = nameByteRefusal(news.name);
      if (nameRefusal !== undefined) {
        return yield* Effect.fail(
          new PostgresDatabaseNameRefused({ name: news.name, ...nameRefusal }),
        );
      }
      return yield* withPg((pg) => reconcileWithClient(pg, news));
    }),

  delete: ({ olds }) => Effect.fail(new PostgresDatabaseDropRefused({ database: olds.name })),
});

export const PostgresDatabaseProvider = () =>
  Provider.succeed(PostgresDatabase, postgresDatabaseHandlers);
