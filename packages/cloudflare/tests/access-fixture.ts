/**
 * A real Access team, in miniature: RSA keypairs, a certs endpoint, and signed tokens.
 *
 * ★ REAL RS256 SIGNATURES, NOT A STUBBED VERIFIER. The interesting failures here —
 *   a tampered payload, an unknown `kid`, a rotated key — are only reachable if the
 *   signature check is genuinely running. A fake `jwtVerify` would pass all of them.
 *
 * ⚠️ EVERY TEST NEEDS ITS OWN TEAM DOMAIN. `access.ts` caches one remote JWKS per team
 *   domain in module scope for the life of the process, which is right in production and
 *   deadly in a test file: the second test would silently reuse the first test's keys and
 *   its stubbed fetch. `team()` hands out a fresh unique domain for exactly that reason.
 */
import { type CryptoKey, type JWK, SignJWT, exportJWK, generateKeyPair } from 'jose';

export const ALG = 'RS256';

let counter = 0;

/** A unique team domain, so no two tests share a cached JWKS. */
export function team(): string {
  counter += 1;
  return `https://t${String(counter)}-${String(Date.now())}.cloudflareaccess.com`;
}

export interface Signer {
  readonly kid: string;
  readonly jwk: JWK;
  readonly sign: (claims: Record<string, unknown>, overrides?: SignOverrides) => Promise<string>;
}

export interface SignOverrides {
  readonly issuer?: string;
  readonly audience?: string;
  /** Seconds since epoch. */
  readonly expiresAt?: number;
  readonly issuedAt?: number;
  readonly notBefore?: number;
}

/** One signing key, with a `kid`, able to mint tokens for a given team. */
export async function signer(kid: string, teamDomain: string): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: ALG, use: 'sig' };

  return {
    kid,
    jwk,
    sign: async (claims, overrides) => {
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: ALG, kid })
        .setIssuer(overrides?.issuer ?? teamDomain)
        .setAudience(overrides?.audience ?? AUD)
        .setIssuedAt(overrides?.issuedAt ?? now)
        .setExpirationTime(overrides?.expiresAt ?? now + 3600);

      if (overrides?.notBefore !== undefined) jwt.setNotBefore(overrides.notBefore);
      return await jwt.sign(privateKey as unknown as CryptoKey);
    },
  };
}

/** The AUD every fixture token carries unless a test overrides it. */
export const AUD = 'aud-for-this-app';

/**
 * Point global `fetch` at a certs endpoint serving `keys`, and count the calls.
 *
 * ⛔ RESTORE IT. Returns a `restore()` the caller must run, or a later test in the same
 *   process inherits this stub and fails somewhere unrelated.
 */
export function stubCerts(
  teamDomain: string,
  keys: readonly JWK[],
  options?: { readonly status?: number },
): { readonly calls: () => number; readonly restore: () => void } {
  const real = globalThis.fetch;
  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== certsUrl) return await real(input as RequestInfo, init);

    calls += 1;
    const status = options?.status ?? 200;
    return new Response(status === 200 ? JSON.stringify({ keys }) : 'nope', {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  return { calls: () => calls, restore: () => void (globalThis.fetch = real) };
}

/** Flip one character in the payload segment — a valid shape with a broken signature. */
export function tamper(token: string): string {
  const [header, payload, signature] = token.split('.');
  const decoded = atob((payload ?? '').replace(/-/g, '+').replace(/_/g, '/'));
  const swapped = decoded.replace(/"email":"[^"]*"/, '"email":"attacker@example.com"');
  const reencoded = btoa(swapped).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${String(header)}.${reencoded}.${String(signature)}`;
}
