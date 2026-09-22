/**
 * `@homeflare/cloudflare/access-auth` — a Cloudflare Access verifier for a reverse proxy's
 * `forward_auth`, so a surface that is not a Worker can be protected by Access properly.
 *
 * ★ WHY THIS IS A SUBPATH AND NOT THE MAIN ENTRY. The package entry is the workerd layer.
 *   This handler is runtime-neutral — `Request` in, `Response` out, no platform import —
 *   because the process that runs it sits next to the proxy, typically under Bun or Node,
 *   not on workerd. A subpath keeps that opt-in explicit and leaves the entry unchanged.
 *
 * ⛔ THE AUD IS THE WHOLE CHECK. Every Access application in one account is signed by the
 *   SAME team keys, so a token minted for a different app in your own account verifies
 *   perfectly against issuer and signature. Only `audience` says the token was minted for
 *   THIS application. A verifier that checks `iss` alone admits every Access user of every
 *   app you run — which reads as working, for everyone, until the wrong person tries.
 *
 * ⚠️ THIS PROTECTS THE PROXY HOP, NOT THE ORIGIN PORT. Verifying the JWT is worth nothing
 *   if the upstream is also reachable directly; bind it to loopback, or the check is an
 *   ornament on a door that is propped open. docs/access-auth.md says it again with the
 *   Caddyfile.
 */
export {
  accessForwardAuth,
  type AccessForwardAuthOptions,
  type DenyReason,
  type IdentityHeaders,
} from './handler.ts';
export {
  ACCESS_COOKIE,
  ACCESS_HEADER,
  accessToken,
  readCookie,
  type FoundToken,
  type TokenSource,
} from './token.ts';
