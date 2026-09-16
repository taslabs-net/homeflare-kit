/**
 * @homeflare/auth — Better Auth storage for Workers/D1, official adapter only.
 *
 * ⛔ THIS IS NOT AN AUTH FACTORY. The export is `createD1AuthStorage`: D1 + schema in,
 *   `{ db, database }` out. Plugins, hooks, schema shape, request-derived base URL and
 *   `ExecutionContext` background tasks stay in the consuming app. AnyAuth is the first
 *   intended consumer; a closed `createAuth()` would be the wrong abstraction for it.
 *
 * ⛔ NOT `better-auth-cloudflare`. That community adapter is a different stack. This
 *   package wires `drizzle-orm/d1` to `@better-auth/drizzle-adapter` and stops there.
 *
 * ⛔ SERVER-ONLY. Do not import this from a client module. Secrets and the database
 *   adapter live on the Worker; the browser talks to `auth-client.ts`.
 *
 * ⚠️ TWO DIFFERENT KINDS OF AUTH, AND THEY ARE NOT INTERCHANGEABLE:
 *     @homeflare/cloudflare  — Cloudflare Access: the edge already authenticated the
 *                              caller; you are verifying its assertion (jose, no state).
 *     @homeflare/auth        — Better Auth: YOU are the identity provider — sessions,
 *                              accounts, a database.
 *   Reaching for the wrong one produces a system that looks authenticated and is not.
 *
 * ★ WHY ITS OWN PACKAGE AND NOT PART OF @homeflare/cloudflare. The adapter and drizzle
 *   are an ORM-shaped dependency. A Worker that only wants structured logging or an
 *   Access JWT check should not resolve them to get it.
 */

export { VERSION } from './version.ts';
export {
  createD1AuthStorage,
  type D1AuthBinding,
  type D1AuthSchema,
  type D1AuthStorage,
} from './storage.ts';
