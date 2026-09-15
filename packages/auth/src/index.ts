/**
 * @homeflare/auth — Better Auth, wired the HomeFlare way.
 *
 * ⛔ SCAFFOLD ONLY, DELIBERATELY. The dependencies are declared and resolve; there is no
 *   API yet, because the shape of a shared auth helper should be decided by the first
 *   app that needs one rather than guessed here. Exporting a wrong abstraction now is
 *   more expensive than exporting nothing.
 *
 * ★ WHY ITS OWN PACKAGE AND NOT PART OF @homeflare/cloudflare. better-auth-cloudflare
 *   pulls drizzle-orm as a hard dependency and peers @better-auth/drizzle-adapter
 *   (measured 2026-09-15). A Worker that only wants structured logging or an Access JWT
 *   check should not resolve an ORM to get it.
 *
 * ⚠️ TWO DIFFERENT KINDS OF AUTH, AND THEY ARE NOT INTERCHANGEABLE:
 *     @homeflare/cloudflare  — Cloudflare Access: the edge already authenticated the
 *                              caller; you are verifying its assertion (jose, no state).
 *     @homeflare/auth        — Better Auth: YOU are the identity provider — sessions,
 *                              accounts, a database.
 *   Reaching for the wrong one produces a system that looks authenticated and is not.
 */

export { VERSION } from './version.ts';
