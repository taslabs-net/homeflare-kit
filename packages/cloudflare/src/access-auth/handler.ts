/**
 * A Cloudflare Access verifier shaped for Caddy's `forward_auth`.
 *
 * ★ WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT. The verification is
 *   `verifyAccessToken` in `../access.ts` — jose, a cached remote JWKS, a circuit breaker.
 *   This file is the HTTP shape around it: find the token, answer 2xx or 4xx, and hand the
 *   identity to the upstream as headers. There is no second verifier here, on purpose; two
 *   implementations of a signature check is how one of them silently stops checking.
 *
 * ⛔ FAIL CLOSED, ALWAYS. Every path that does not end in a verified identity returns a
 *   non-2xx, including a JWKS endpoint that is down. Caddy grants access on 2xx and only
 *   on 2xx, so an exception escaping this handler would become a 502 from Caddy — still
 *   closed, but without a log line. Hence the catch-all.
 *
 * ⛔ NEVER LOG THE TOKEN. Not at debug, not in an error message, not truncated. A token in
 *   a log file is a replayable session for the whole of its `exp`. `reason` below is a
 *   fixed enum and the caught error contributes only its CLASS NAME — jose's messages are
 *   safe today, but "safe today" is not a property worth betting a credential on.
 *
 * Guide, and the Caddyfile that calls this: docs/access-auth.md.
 */
import { type AccessIdentity, type AccessOptions, verifyAccessToken } from '../access.ts';
import { type Logger, log } from '../log.ts';
import { type TokenSource, accessToken } from './token.ts';

/** Why a request was refused. A closed set, so it is safe to log and safe to alert on. */
export type DenyReason =
  | 'no-token'
  | 'invalid-token'
  | 'jwks-unavailable'
  | 'not-authorized'
  | 'unexpected';

/** The headers the upstream receives on success. Values are always strings, never absent. */
export interface IdentityHeaders {
  /** @default 'X-Access-Email' */
  readonly email?: string;
  /** @default 'X-Access-Sub' */
  readonly sub?: string;
}

export interface AccessForwardAuthOptions extends AccessOptions {
  /** Rename the identity headers to match an upstream that expects its own names. */
  readonly headers?: IdentityHeaders;
  /**
   * An extra check on an already-verified identity. `false` is a 403, not a 401.
   * ⚠️ AUTHORIZATION, NOT AUTHENTICATION. The Access policy is the real gate; this is for
   *   an upstream that additionally wants, say, one team. Do not use it to re-check `aud`.
   */
  readonly authorize?: (identity: AccessIdentity) => boolean | Promise<boolean>;
  /** @default the package logger */
  readonly logger?: Logger;
}

const DEFAULT_HEADERS = { email: 'X-Access-Email', sub: 'X-Access-Sub' } as const;

/**
 * ⛔ A JWKS FAILURE MUST NOT READ AS A BAD TOKEN. They need opposite responses from an
 *   operator — rotate nothing versus page someone — and they are indistinguishable in the
 *   caller's 401. jose surfaces the breaker's error as the `cause` of a JWKS error, so the
 *   class names of both the error and its cause are checked.
 */
function reasonFor(error: unknown): DenyReason {
  // ⚠️ WALK THE `cause` CHAIN. jose wraps a transport failure, so the interesting error is
  //   rarely the outermost one — matching only on `error.name` reports every JWKS outage
  //   as a bad token, which is the diagnosis that sends an operator to the wrong system.
  for (let cur: unknown = error, hops = 0; cur instanceof Error && hops < 4; hops += 1) {
    // The breaker in ../jwks-breaker.ts throws exactly this for a non-200 certs endpoint.
    if (cur.message.includes('JWKS endpoint answered')) return 'jwks-unavailable';
    // `JWKSTimeout` is jose's; a bare `TypeError` from the fetch seam is "network refused".
    if (cur.name === 'JWKSTimeout' || cur.name === 'TypeError') return 'jwks-unavailable';
    cur = cur.cause;
  }

  // ⛔ EVERYTHING ELSE IS A BAD TOKEN, INCLUDING `JWKSNoMatchingKey`. An unknown `kid` from
  //   a healthy endpoint means the token was signed by a key this team does not publish —
  //   that is a forgery or a long-rotated token, never an outage. Classing it as an outage
  //   would hide a forged token in the alert that says "Cloudflare is down".
  return 'invalid-token';
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** ⛔ No body, no `WWW-Authenticate` detail, no reason. An unauthenticated caller learns
 *  nothing about why; the reason goes to the log, where an operator can read it. */
function deny(status: 401 | 403): Response {
  return new Response(null, { status });
}

/**
 * Build the `fetch` handler Caddy's `forward_auth` calls.
 *
 * ```ts
 * const verify = accessForwardAuth({
 *   teamDomain: 'https://example.cloudflareaccess.com',
 *   audience: process.env.ACCESS_AUD,
 * });
 * Bun.serve({ port: 9101, hostname: '127.0.0.1', fetch: verify });
 * ```
 *
 * ⛔ ONE HANDLER PER ACCESS APPLICATION. `audience` is fixed at construction and is never
 *   read from the request — an AUD a caller can influence is the whole vulnerability this
 *   exists to prevent. Protecting two applications means two handlers and two routes.
 *
 * ★ RETURNS A PLAIN `(Request) => Promise<Response>`, so it needs no server framework and
 *   no runtime-specific import: `Bun.serve`, `node:http`'s fetch adapters and workerd all
 *   take it as-is. Routing several of these by path is the consumer's own `if`.
 */
export function accessForwardAuth(
  options: AccessForwardAuthOptions,
): (request: Request) => Promise<Response> {
  const names = { ...DEFAULT_HEADERS, ...options.headers };
  const logger = options.logger ?? log;
  assertTeamDomain(options.teamDomain);

  return async (request: Request): Promise<Response> => {
    const found = accessToken(request);
    if (found === undefined) {
      logger.warn('access denied', { reason: 'no-token' satisfies DenyReason });
      return deny(401);
    }

    let identity: AccessIdentity;
    try {
      identity = await verifyAccessToken(found.token, options);
    } catch (error) {
      const reason = reasonFor(error);
      logger.warn('access denied', { reason, source: found.source, error: errorClass(error) });
      return deny(401);
    }

    try {
      if (options.authorize !== undefined && !(await options.authorize(identity))) {
        // ⚠️ 403, not 401: re-authenticating cannot help, and a 401 sends the browser back
        //   to Access for a login it already completed — an infinite redirect loop.
        logger.warn('access denied', {
          reason: 'not-authorized' satisfies DenyReason,
          email: identity.email ?? '',
        });
        return deny(403);
      }
    } catch (error) {
      // ⛔ A THROWING `authorize` IS A DENIAL, NOT A GRANT. A consumer's callback that hits
      //   its own database and fails must not fall through to the success path; letting the
      //   exception escape would hand Caddy a 502, which is also closed but arrives with no
      //   log line saying whose callback broke.
      logger.error('access denied', {
        reason: 'unexpected' satisfies DenyReason,
        error: errorClass(error),
      });
      return deny(403);
    }

    return granted(identity, names, found.source);
  };
}

/**
 * ⛔ EVERY IDENTITY HEADER IS SET ON EVERY 2xx, empty string included. This is the
 *   spoofing defence, and it is not optional.
 *   🔴 Caddy's `copy_headers` expands to `request_header <Name> {rp.header.<Name>}` inside
 *     a 2xx handler — it copies FROM the auth response ONTO the client's request. A client
 *     that sends `X-Access-Email: admin@example.com` itself is overwritten only if this
 *     response carries that header. Omitting it for a token with no `email` claim would
 *     leave the attacker's value standing, and the upstream would read it as identity.
 *     Always emitting the name closes that whether or not Caddy also clears absent fields
 *     — behaviour its documentation does not actually promise.
 */
function granted(
  identity: AccessIdentity,
  names: Required<IdentityHeaders>,
  source: TokenSource,
): Response {
  const headers = new Headers();
  headers.set(names.email, identity.email ?? '');
  headers.set(names.sub, identity.sub ?? '');
  headers.set('X-Access-Token-Source', source);
  return new Response(null, { status: 204, headers });
}

/**
 * ⚠️ A TRAILING SLASH BREAKS BOTH CHECKS AT ONCE, AND QUIETLY. `teamDomain` is used
 *   verbatim as the expected `iss` and as the JWKS origin, so `https://x.cloudflareaccess.com/`
 *   yields an `iss` that never matches any real token AND a double-slashed certs URL. The
 *   symptom is every token failing verification with no clue pointing at the config.
 */
function assertTeamDomain(teamDomain: string): void {
  if (!teamDomain.startsWith('https://') || teamDomain.endsWith('/')) {
    throw new Error(
      `access-auth: teamDomain must be https:// with no trailing slash, got ${teamDomain}`,
    );
  }
}
