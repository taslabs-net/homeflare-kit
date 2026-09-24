/**
 * STUB — `@distilled.cloud/cilium` interim surface.
 *
 * ⛔ Not generated quality. One marked stub operation (`getHealthz`) plus
 * Credentials / Errors / Protocol so a future Alchemy provider can import
 * `@distilled.cloud/cilium` after this package is published and aliased.
 * `src/` will be replaced by a regenerate+copy from Cilium's official
 * OpenAPI — do not grow this by hand.
 *
 * @example
 * ```ts
 * import * as Cilium from "@distilled.cloud/cilium";
 *
 * const health = yield* Cilium.Services.daemon.getHealthz({});
 * ```
 */
export * from './credentials.ts';
export * from './errors.ts';
export * as T from './traits.ts';
export { CiliumProtocol, type CiliumOpContext, type CiliumOpError } from './protocol.ts';
export * as Retry from './retry.ts';
export * as Services from './services/index.ts';
export * from './services/daemon.ts';
