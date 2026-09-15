/**
 * Cloudflare Access JWT verification.
 *
 * ★ WHY jose AND NOT A HAND-ROLLED VERIFY. Signature verification is the one place where
 *   a subtle bug is silent and total: a check that never fails looks identical to a
 *   check that always passes. jose handles JWKS fetching, `kid` matching and key
 *   rotation, and it is already in 8 estate packages. This file is the Access-specific
 *   wiring around it, nothing more.
 *
 * ⚠️ THE TRAP THIS CLOSES. Cloudflare's own example does `jwtVerify(...)` inline in the
 *   handler, which builds a NEW remote JWKS on every request — an outbound fetch per
 *   request, and a thundering herd on the certs endpoint under load. The cache below is
 *   keyed by team domain and lives for the isolate's lifetime.
 *
 * ⛔ NEVER SKIP `audience`. Any Access app in your account produces a JWT this team
 *   domain will happily verify; the AUD tag is the only thing that says the token was
 *   minted for THIS app. Verifying issuer alone accepts tokens from a neighbouring app.
 *
 * Docs: developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** The header Access puts the token in. Lowercase — Headers.get is case-insensitive. */
const ACCESS_HEADER = 'cf-access-jwt-assertion';

export interface AccessOptions {
  /** `https://<team>.cloudflareaccess.com` — the issuer, and the JWKS host. */
  readonly teamDomain: string;
  /** The application's AUD tag, from Zero Trust → Access → Applications. */
  readonly audience: string;
}

/** The subset of Access claims worth depending on. */
export interface AccessIdentity {
  readonly email: string | undefined;
  readonly sub: string | undefined;
  /** Everything else, for callers that need a claim this interface does not name. */
  readonly claims: Readonly<Record<string, unknown>>;
}

/**
 * One JWKS per team domain, reused for the isolate's life.
 * ⚠️ Module scope is per-isolate on workerd, not per-request and not global. That is
 *   exactly the right lifetime here: long enough to amortise the fetch, short enough
 *   that a rotated key is picked up when the isolate recycles. jose also refreshes on
 *   an unknown `kid`.
 */
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwks.get(teamDomain);
  if (existing !== undefined) return existing;

  const created = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  jwks.set(teamDomain, created);
  return created;
}

/**
 * Verify the Access JWT on `request`, returning the identity it asserts.
 *
 * ⛔ THROWS ON EVERY FAILURE — missing header, bad signature, wrong audience, expired.
 *   ★ Deliberately not a boolean or a null: an `if (!ok)` that a caller forgets to write
 *     is an open door, whereas an unhandled throw is a 500 and a log line. Callers that
 *     want a soft path catch it explicitly.
 */
export async function verifyAccessJwt(
  request: Request,
  options: AccessOptions,
): Promise<AccessIdentity> {
  const token = request.headers.get(ACCESS_HEADER);
  if (token === null) throw new Error('access: no Cf-Access-Jwt-Assertion header');

  const { payload } = await jwtVerify(token, keysFor(options.teamDomain), {
    issuer: options.teamDomain,
    audience: options.audience,
  });

  return {
    email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
    sub: payload.sub,
    claims: payload,
  };
}
