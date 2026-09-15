/**
 * @homeflare/cloudflare — the Workers-specific layer.
 *
 * ⛔ WHY THIS IS A SEPARATE PACKAGE FROM @homeflare/kit. Code here may assume workerd:
 *   Cloudflare's global types, its bindings, its `console.log`-is-structured-logging
 *   behaviour. `@homeflare/kit` may not — it runs anywhere. Keeping them apart is what
 *   lets a Node script depend on the kit without pulling Workers types into its
 *   resolution.
 */

export { VERSION } from './version.ts';
export { verifyAccessJwt, type AccessIdentity, type AccessOptions } from './access.ts';
export { log, type LogFields, type Logger } from './log.ts';
