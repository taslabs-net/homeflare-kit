/**
 * `@homeflare/seat-runtime/state` — a seat's Postgres and Valkey state, on its own subpath.
 *
 * ⛔ NOT THE ROOT ENTRY, ON PURPOSE. The root stays runtime-neutral (`fetch` only). This one holds
 *   `node:net` through `@effect/sql-pg` and `Bun.RedisClient`, so a consumer opts in to it
 *   explicitly, the way the kit's other host-specific code is reached.
 */
export * as SeatState from './seat-state.ts';
