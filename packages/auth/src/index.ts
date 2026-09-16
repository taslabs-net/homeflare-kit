/**
 * @homeflare/auth — Better Auth on Workers/D1, via the official adapter.
 *
 * ★ WHY ITS OWN PACKAGE AND NOT PART OF @homeflare/cloudflare. The drizzle adapter
 *   pulls an ORM. A Worker that only wants structured logging or an Access JWT check
 *   should not resolve one.
 *
 * ⚠️ TWO DIFFERENT KINDS OF AUTH, AND THEY ARE NOT INTERCHANGEABLE:
 *     @homeflare/cloudflare  — Cloudflare Access: the edge already authenticated the
 *                              caller; you are verifying its assertion (jose, no state).
 *     @homeflare/auth        — Better Auth: YOU are the identity provider — sessions,
 *                              accounts, a database.
 *   Reaching for the wrong one produces a system that looks authenticated and is not.
 *
 * ⛔ NOT better-auth-cloudflare. That package takes over plugins, schema, baseURL and
 *   waitUntil. This one binds D1 and waitUntil, and leaves the rest to the app.
 */

export { VERSION } from './version.ts';
export {
  createWorkersAuth,
  type WaitUntil,
  type WorkersAuth,
  type WorkersAuthOptions,
} from './workers-auth.ts';
