/**
 * STUB — `@distilled.cloud/traefik` interim surface.
 *
 * ⛔ Not generated quality. One marked stub operation (`getVersion`) plus
 * Credentials / Errors / Protocol so a future Alchemy provider can import
 * `@distilled.cloud/traefik` after this package is published and aliased.
 * `src/` will be replaced by a regenerate+copy — do not grow this by hand.
 *
 * @example
 * ```ts
 * import * as Traefik from "@distilled.cloud/traefik";
 *
 * const version = yield* Traefik.Services.traefik.getVersion({});
 * ```
 */
export * from './credentials.ts';
export * from './errors.ts';
export * as T from './traits.ts';
export {
  TraefikProtocol,
  type TraefikOpContext,
  type TraefikOpError,
} from './protocol.ts';
export * as Retry from './retry.ts';
export * as Services from './services/index.ts';
export * from './services/traefik.ts';
