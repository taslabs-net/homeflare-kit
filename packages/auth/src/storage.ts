/**
 * D1 storage for official Better Auth — not an auth factory.
 *
 * ★ WHY A STORAGE PRIMITIVE AND NOT `createAuth()`. AnyAuth already has one substantial
 *   issuer (`workers/issuer/auth.ts` + `db.ts`). Plugins, hooks, schema, request-derived
 *   base URL / rpID, and `ExecutionContext.waitUntil` belong THERE. Wrapping `betterAuth()`
 *   here would steal that control and freeze the wrong shape into a published API.
 *   The only shared bit is "D1 binding + schema → drizzle client + adapter config".
 *
 * ⛔ OFFICIAL ADAPTER ONLY. `drizzle-orm/d1` and `@better-auth/drizzle-adapter`, which
 *   AnyAuth already runs. `better-auth-cloudflare` is a community wrapper that pulls its
 *   own drizzle and its own Better Auth wiring — adopting it would violate the issuer's
 *   architecture, which is why AnyAuth refused to install this package while it depended
 *   on that adapter.
 *
 * ⛔ SERVER-ONLY. This module imports the D1 driver and the adapter. Never import it from
 *   `auth-client.ts`, a React file, or any Vite client graph — that would put the
 *   database adapter in a browser bundle. Keep `auth.ts` (server) and `auth-client.ts`
 *   (hooks) in separate files; Better Auth's own plugin docs require the same split.
 *
 * ★ LET THE CONSUMER'S `betterAuth()` INFER PLUGIN TYPES. Returning the adapter factory
 *   (not an auth instance) is what keeps deep inference at the call site. Wrapping
 *   `betterAuth()` here would force-cast or generic-erase plugins, which is the failure
 *   mode in better-auth#5047. No `as any`, no `as BetterAuthOptions`.
 *
 * ⚠️ oxlint is AST-based, not type-aware — Better Auth's generics do not stall it.
 *   `tsc --noEmit` is the type gate. Do not add type-aware lint rules to "catch" this
 *   package; they would crawl those generics on every file and buy nothing oxlint + tsc
 *   do not already split between them.
 *
 * ★ The binding type is drizzle's, not the workerd global. Naming `D1Database` here
 *   would need a `/// <reference types="@cloudflare/workers-types" />`, and that
 *   reference collides with Bun's `BunFile` when a repo-root `tsc` follows an import
 *   into this file. `Parameters<typeof drizzle>[0]` is the same contract without
 *   pulling Workers types into a Node/Bun compilation.
 */
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';

/** A Drizzle schema object — tables keyed by name, as `drizzle-orm` expects. */
export type D1AuthSchema = Record<string, unknown>;

/** Whatever `drizzle-orm/d1` accepts as a client — a `D1Database` binding in a Worker. */
export type D1AuthBinding = Parameters<typeof drizzle>[0];

/**
 * What `createD1AuthStorage` returns.
 *
 * - `db` is the Drizzle client, for the app's own queries (audit, bootstrap, …).
 * - `database` is the value Better Auth's `database` option wants: the official
 *   adapter factory, already bound to sqlite / this schema.
 */
export interface D1AuthStorage<TSchema extends D1AuthSchema = D1AuthSchema> {
  readonly db: DrizzleD1Database<TSchema> & { $client: D1AuthBinding };
  readonly database: ReturnType<typeof drizzleAdapter>;
}

/**
 * Bind a D1 database and a Drizzle schema as Better Auth storage.
 *
 *     const { db, database } = createD1AuthStorage(env.DB, schema);
 *     const auth = betterAuth({ database, plugins: […], … });
 *
 * ⛔ Does not call `betterAuth()`. Provider is sqlite because D1 is sqlite; there is no
 *   second dialect to pick.
 */
export function createD1AuthStorage<TSchema extends D1AuthSchema>(
  binding: D1AuthBinding,
  schema: TSchema,
): D1AuthStorage<TSchema> {
  const db = drizzle(binding, { schema });

  return {
    db,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  };
}
