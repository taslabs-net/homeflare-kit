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
/**
 * ★ THREE AUTH PATHS, AND THEY ARE NOT ALTERNATIVES — pick by where your code runs:
 *
 *   accessIdentity(ctx)   A Worker BEHIND Access. The edge already enforced the policy
 *                         and attached the identity; no token handling. Prefer this.
 *   verifyAccessJwt(req)  An origin with no `ctx.access` — service-to-service, a
 *                         non-Worker origin, or a Worker reached by service binding
 *                         (⚠️ `ctx.access` does not propagate through bindings).
 *   serveMcpMetadata()    An MCP server. Neither of the above helps a client DISCOVER
 *                         how to authenticate; RFC 9728 is what does.
 */
export {
  accessIdentity,
  hasAccess,
  type AccessContext,
  type AccessIdentityInfo,
} from './access-identity.ts';
/**
 * ⚠️ `verifyAccessToken` IS THE SAME CHECK WITH THE TOKEN ALREADY IN HAND — for a caller
 *   that read it from somewhere other than the header (a cookie, a WebSocket subprotocol).
 *   It is not a lighter variant: identical issuer, audience and expiry checks.
 *   ★ Protecting a non-Worker origin behind a reverse proxy? `@homeflare/cloudflare/access-auth`
 *     is the ready-made `forward_auth` handler; you do not need to assemble one from these.
 */
export {
  verifyAccessJwt,
  verifyAccessToken,
  type AccessIdentity,
  type AccessOptions,
} from './access.ts';
export {
  protectedResourceMetadata,
  serveMcpMetadata,
  unauthorizedResponse,
  wellKnownPath,
  type McpMetadataOptions,
  type ProtectedResourceMetadata,
} from './mcp-metadata.ts';
export { log, type LogFields, type Logger } from './log.ts';
export { BREAKER_COOLDOWN_MS, breakered } from './jwks-breaker.ts';
