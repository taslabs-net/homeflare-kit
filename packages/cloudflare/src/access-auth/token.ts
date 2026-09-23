/**
 * Finding the Access token on an inbound request — header first, cookie second.
 *
 * ★ BOTH, BECAUSE NEITHER IS GUARANTEED. Cloudflare's validation guide says the
 *   `CF_Authorization` cookie "is not guaranteed to be passed" and to prefer the
 *   `Cf-Access-Jwt-Assertion` header. The reverse also happens: the header is attached by
 *   the Access hop, so a request that reaches the origin through a further proxy — or a
 *   browser replaying its own cookie — can carry the cookie and not the header. Checking
 *   one only is a 401 that looks like a broken login and is actually a missing branch.
 *
 * ⛔ THE HEADER WINS WHEN BOTH ARE PRESENT, and that order is load-bearing. The header is
 *   set by the Access hop on this request; the cookie is whatever the client's jar held.
 *   Preferring the cookie would let a client pin a stale token over the fresh assertion.
 *   ⚠️ Neither is trusted here — both are verified identically by `verifyAccessToken`.
 *   This is about which candidate is tried, not about which is believed.
 */

/** The header Access sets on the request it forwards to the origin. */
export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

/** The cookie Access sets in the browser. */
export const ACCESS_COOKIE = 'CF_Authorization';

/** Where a candidate token was found. Useful in a log line; never a trust signal. */
export type TokenSource = 'header' | 'cookie';

export interface FoundToken {
  readonly token: string;
  readonly source: TokenSource;
}

/**
 * Read one cookie out of a `Cookie` header value.
 *
 * ⚠️ HAND-PARSED, AND SMALL ON PURPOSE. A cookie library would bring parsing of
 *   attributes (Path, SameSite, Max-Age) that only ever appear on `Set-Cookie`, which is
 *   the response side. Requests carry a bare `name=value; name=value` list, and that is
 *   all this reads.
 * ⚠️ A JWT is base64url and contains no `;` or `=`-in-value ambiguity beyond padding, but
 *   this still splits on the FIRST `=` only — a value containing `=` (base64 padding) is
 *   otherwise truncated mid-token, which fails verification with a signature error and
 *   sends you hunting in the wrong place.
 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;

    const value = pair.slice(eq + 1).trim();
    return value === '' ? undefined : value;
  }

  return undefined;
}

/**
 * The Access token on `request`, or `undefined` when it carries none.
 *
 * ⛔ RETURNS THE CANDIDATE UNVERIFIED. Every caller must hand the result to
 *   `verifyAccessToken`; nothing about being present in a header makes a token valid.
 */
export function accessToken(request: Request): FoundToken | undefined {
  const fromHeader = request.headers.get(ACCESS_HEADER);
  if (fromHeader !== null && fromHeader !== '') return { token: fromHeader, source: 'header' };

  const fromCookie = readCookie(request.headers.get('Cookie'), ACCESS_COOKIE);
  if (fromCookie !== undefined) return { token: fromCookie, source: 'cookie' };

  return undefined;
}
