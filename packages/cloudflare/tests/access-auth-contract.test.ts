/**
 * The contract with the reverse proxy: where the token may come from, what the upstream is
 * told, and what never reaches a log.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { accessForwardAuth, accessToken, readCookie } from '../src/access-auth/index.ts';
import type { LogFields, Logger } from '../src/log.ts';
import { resetBreaker } from '../src/jwks-breaker.ts';
import { AUD, signer, stubCerts, team } from './access-fixture.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  resetBreaker();
});

/** A logger that keeps every line, so a test can assert on what was written. */
function recorder(): { readonly lines: string[]; readonly logger: Logger } {
  const lines: string[] = [];
  const write = (level: string) => (message: string, fields?: LogFields) =>
    void lines.push(JSON.stringify({ level, message, ...fields }));
  const logger: Logger = {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    with: () => logger,
  };
  return { lines, logger };
}

/** A team serving one key, plus a signer for it. */
async function setup() {
  const teamDomain = team();
  const key = await signer('kid-1', teamDomain);
  const certs = stubCerts(teamDomain, [key.jwk]);
  restores.push(certs.restore);
  return { teamDomain, key };
}

describe('token source', () => {
  test('accepts the CF_Authorization cookie when the header is absent', async () => {
    // ⚠️ Cloudflare's own guide says the cookie "is not guaranteed to be passed" — the
    //    reverse is true too, so a header-only verifier 401s a genuinely authenticated user.
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({ teamDomain, audience: AUD });
    const token = await key.sign({ email: 'c@example.com' });

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: { Cookie: `theme=dark; CF_Authorization=${token}; other=1` },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('X-Access-Email')).toBe('c@example.com');
    expect(response.headers.get('X-Access-Token-Source')).toBe('cookie');
  });

  test('prefers the header over the cookie when both are present', async () => {
    // ⛔ The header is set by the Access hop on THIS request; the cookie is whatever the
    //    client's jar held. Preferring the cookie would let a client pin a stale token.
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({ teamDomain, audience: AUD });
    const fresh = await key.sign({ email: 'fresh@example.com' });
    const stale = await key.sign({ email: 'stale@example.com' });

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: { 'Cf-Access-Jwt-Assertion': fresh, Cookie: `CF_Authorization=${stale}` },
      }),
    );

    expect(response.headers.get('X-Access-Email')).toBe('fresh@example.com');
    expect(response.headers.get('X-Access-Token-Source')).toBe('header');
  });

  test('readCookie handles padding, spacing and absence', () => {
    expect(readCookie('a=1; CF_Authorization=ab==; b=2', 'CF_Authorization')).toBe('ab==');
    expect(readCookie('CF_Authorization=', 'CF_Authorization')).toBeUndefined();
    expect(readCookie(null, 'CF_Authorization')).toBeUndefined();
    expect(readCookie('novalue', 'CF_Authorization')).toBeUndefined();
  });

  test('accessToken returns undefined rather than an empty candidate', () => {
    const request = new Request('https://o.example/', {
      headers: { 'Cf-Access-Jwt-Assertion': '' },
    });
    expect(accessToken(request)).toBeUndefined();
  });
});

describe('upstream headers', () => {
  test('always sets every identity header, so a client cannot supply its own', async () => {
    // 🔴 THE SPOOFING DEFENCE. Caddy's copy_headers copies FROM this response ONTO the
    //    client's request. A token with no `email` claim must still emit the header, or a
    //    client-supplied `X-Access-Email: admin@…` survives and the upstream believes it.
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({ teamDomain, audience: AUD });
    const anonymous = await key.sign({ sub: 'service-token' }); // no email claim

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: {
          'Cf-Access-Jwt-Assertion': await Promise.resolve(anonymous),
          'X-Access-Email': 'admin@example.com',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.has('X-Access-Email')).toBe(true);
    expect(response.headers.get('X-Access-Email')).toBe('');
  });

  test('renames the headers when the upstream expects its own names', async () => {
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({
      teamDomain,
      audience: AUD,
      headers: { email: 'Remote-Email', sub: 'Remote-User' },
    });

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: {
          'Cf-Access-Jwt-Assertion': await key.sign({ email: 'r@example.com', sub: 's' }),
        },
      }),
    );

    expect(response.headers.get('Remote-Email')).toBe('r@example.com');
    expect(response.headers.get('Remote-User')).toBe('s');
  });
});

describe('authorize', () => {
  test('a verified identity refused by authorize is 403, not 401', async () => {
    // ⚠️ 401 would bounce the browser back to Access for a login it already completed —
    //    a redirect loop rather than an error the user can read.
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({
      teamDomain,
      audience: AUD,
      authorize: (identity) => identity.email === 'allowed@example.com',
    });

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: { 'Cf-Access-Jwt-Assertion': await key.sign({ email: 'other@example.com' }) },
      }),
    );
    expect(response.status).toBe(403);
  });

  test('an authorize callback that throws denies rather than falling through', async () => {
    const { teamDomain, key } = await setup();
    const verify = accessForwardAuth({
      teamDomain,
      audience: AUD,
      authorize: () => {
        throw new Error('database down');
      },
    });

    const response = await verify(
      new Request('https://origin.example/verify', {
        headers: { 'Cf-Access-Jwt-Assertion': await key.sign({ email: 'a@example.com' }) },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('log hygiene', () => {
  test('never writes the token, on any denial path', async () => {
    // ⛔ A token in a log file is a replayable session for the whole of its `exp`.
    const { teamDomain, key } = await setup();
    const { lines, logger } = recorder();
    const verify = accessForwardAuth({ teamDomain, audience: 'a-different-app', logger });
    const token = await key.sign({ email: 'a@example.com' });

    await verify(
      new Request('https://origin.example/verify', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
    );
    await verify(
      new Request('https://origin.example/verify', {
        headers: { Cookie: `CF_Authorization=${token}` },
      }),
    );

    expect(lines.length).toBe(2);
    const all = lines.join('\n');
    expect(all).not.toContain(token);
    // Not even a fragment: the signature segment alone is enough to matter.
    expect(all).not.toContain(token.split('.')[2] ?? 'unreachable');
    expect(all).toContain('invalid-token');
  });
});
