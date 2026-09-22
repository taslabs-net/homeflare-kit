/**
 * The forward_auth handler against a real signing team.
 *
 * ⛔ THE CASE THIS FILE EXISTS FOR IS `rejects a token minted for another Access app`.
 *   Same team, same keys, same issuer, perfect signature — and it must still be refused.
 *   That is the one failure a verifier can have while looking completely healthy.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { accessForwardAuth } from '../src/access-auth/index.ts';
import { resetBreaker } from '../src/jwks-breaker.ts';
import { AUD, signer, stubCerts, tamper, team } from './access-fixture.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  resetBreaker();
});

/** A team whose certs endpoint serves `kid-1`, plus a handler bound to this app's AUD. */
async function setup(options?: { readonly status?: number }) {
  const teamDomain = team();
  const key = await signer('kid-1', teamDomain);
  const certs = stubCerts(teamDomain, [key.jwk], options ?? {});
  restores.push(certs.restore);

  return {
    teamDomain,
    key,
    certs,
    verify: accessForwardAuth({ teamDomain, audience: AUD }),
  };
}

const withHeader = (token: string): Request =>
  new Request('https://origin.example/verify', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });

describe('accessForwardAuth', () => {
  test('grants a valid token and exposes the identity to the upstream', async () => {
    const { key, verify } = await setup();
    const response = await verify(
      withHeader(await key.sign({ email: 'a@example.com', sub: 'u1' })),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('X-Access-Email')).toBe('a@example.com');
    expect(response.headers.get('X-Access-Sub')).toBe('u1');
  });

  test('rejects a token minted for another Access app in the same account', async () => {
    // 🔴 THE VULNERABILITY. Signed by the right team with the right key and a valid
    //    issuer — only the AUD differs. Verifying `iss` alone would admit this, and with
    //    it every Access user of every other app in the account.
    const { key, verify } = await setup();
    const other = await key.sign({ email: 'a@example.com' }, { audience: 'a-different-app' });

    expect((await verify(withHeader(other))).status).toBe(401);
  });

  test('rejects a token from a different team, even with a matching aud', async () => {
    const { key, verify } = await setup();
    const foreign = await key.sign({}, { issuer: 'https://evil.cloudflareaccess.com' });

    expect((await verify(withHeader(foreign))).status).toBe(401);
  });

  test('rejects an expired token', async () => {
    const { key, verify } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const stale = await key.sign({}, { expiresAt: now - 60, issuedAt: now - 3600 });

    expect((await verify(withHeader(stale))).status).toBe(401);
  });

  test('rejects a token that is not yet valid', async () => {
    const { key, verify } = await setup();
    const early = await key.sign({}, { notBefore: Math.floor(Date.now() / 1000) + 600 });

    expect((await verify(withHeader(early))).status).toBe(401);
  });

  test('rejects a tampered payload', async () => {
    const { key, verify } = await setup();
    const forged = tamper(await key.sign({ email: 'nobody@example.com' }));

    const response = await verify(withHeader(forged));
    expect(response.status).toBe(401);
    expect(response.headers.get('X-Access-Email')).toBeNull();
  });

  test('rejects a token signed by a key the team does not publish', async () => {
    // An unknown `kid`: a forgery, or a key rotated out long ago. Not an outage.
    const { teamDomain, verify } = await setup();
    const stranger = await signer('kid-unknown', teamDomain);

    expect((await verify(withHeader(await stranger.sign({})))).status).toBe(401);
  });

  test('accepts a token signed by a rotated-in key once the endpoint publishes it', async () => {
    const teamDomain = team();
    const oldKey = await signer('kid-old', teamDomain);
    const newKey = await signer('kid-new', teamDomain);

    // The endpoint serves BOTH, as Cloudflare's certs endpoint does across a rotation.
    const certs = stubCerts(teamDomain, [oldKey.jwk, newKey.jwk]);
    restores.push(certs.restore);
    const verify = accessForwardAuth({ teamDomain, audience: AUD });

    expect((await verify(withHeader(await oldKey.sign({ sub: 'o' })))).status).toBe(204);
    expect((await verify(withHeader(await newKey.sign({ sub: 'n' })))).status).toBe(204);
  });

  test('fails closed when the JWKS endpoint is down', async () => {
    // ⛔ Fail CLOSED. A certs endpoint returning 500 must deny, never admit.
    const { key, verify } = await setup({ status: 500 });

    expect((await verify(withHeader(await key.sign({})))).status).toBe(401);
  });

  test('refuses a request carrying no token at all', async () => {
    const { verify } = await setup();
    expect((await verify(new Request('https://origin.example/verify'))).status).toBe(401);
  });

  test('caches the JWKS instead of fetching it per request', async () => {
    const { key, certs, verify } = await setup();
    for (let i = 0; i < 4; i += 1)
      await verify(withHeader(await key.sign({ sub: `u${String(i)}` })));

    expect(certs.calls()).toBe(1);
  });

  test('refuses a teamDomain with a trailing slash at construction', () => {
    // ⚠️ Otherwise every token fails verification with nothing pointing at the config.
    expect(() =>
      accessForwardAuth({ teamDomain: 'https://x.cloudflareaccess.com/', audience: AUD }),
    ).toThrow(/trailing slash/);
  });
});
