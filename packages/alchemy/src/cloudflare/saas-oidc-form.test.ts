/**
 * The pure half of SaasOidcApplication: validation, the issuer URLs (the team domain is a prop,
 * never a constant), drift, the write body and the attribute mapping.
 */
import { describe, expect, test } from 'bun:test';
import { parseApp } from './saas-oidc-wire.ts';
import {
  checkTeam,
  issuerFor,
  needsSync,
  toAttributes,
  validateSaasOidc,
  writeBody,
} from './saas-oidc-form.ts';
import { publicClient } from './saas-oidc-harness.ts';

const live = (over: Record<string, unknown> = {}) =>
  parseApp({
    id: 'app-1',
    aud: 'aud-1',
    type: 'saas',
    name: 'Headlamp',
    domain: 'example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid-1',
    policies: [{ id: 'policy-admin' }],
    saas_app: {
      auth_type: 'oidc',
      client_id: 'cid-1',
      client_secret: 'must-never-be-read',
      redirect_uris: ['https://headlamp.example.test/oidc-callback'],
      scopes: ['openid', 'email', 'groups'],
      grant_types: ['authorization_code_with_pkce'],
      access_token_lifetime: '15m',
      allow_pkce_without_client_secret: true,
    },
    ...over,
  });

describe('validateSaasOidc', () => {
  test('accepts a public PKCE client', () => {
    expect(validateSaasOidc(publicClient())).toBeUndefined();
  });

  test.each([
    '',
    'https://example.cloudflareaccess.com',
    'example.cloudflareaccess.com/x',
    'Team',
    'nodot',
  ])('refuses teamDomain %p', (teamDomain) => {
    expect(validateSaasOidc(publicClient({ teamDomain }))?.message).toContain('teamDomain');
  });

  test('refuses the public-client flag without the PKCE grant', () => {
    const props = publicClient();
    const bad = {
      ...props,
      saasApp: { ...props.saasApp, grantTypes: ['authorization_code' as const] },
    };
    expect(validateSaasOidc(bad)?.message).toContain('authorization_code_with_pkce');
  });

  test('refuses an empty name', () => {
    expect(validateSaasOidc(publicClient({ name: ' ' }))?.message).toContain('name');
  });
});

describe('issuer', () => {
  test('is built from the declared team domain, whatever it is', () => {
    expect(issuerFor('other.cloudflareaccess.com', 'c')).toBe(
      'https://other.cloudflareaccess.com/cdn-cgi/access/sso/oidc/c',
    );
  });

  test('the attributes expose issuer, clientId and jwksEndpoint for the declared team', () => {
    const attrs = toAttributes(live(), 'acct', 'x', 'example.cloudflareaccess.com');
    expect(attrs).toMatchObject({
      teamDomain: 'example.cloudflareaccess.com',
      clientId: 'cid-1',
      issuer: 'https://example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid-1',
      jwksEndpoint: 'https://example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid-1/jwks',
      configurationEndpoint:
        'https://example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/cid-1/.well-known/openid-configuration',
    });
    const other = toAttributes(live(), 'acct', 'x', 'other.cloudflareaccess.com');
    expect(other?.issuer).toStartWith('https://other.cloudflareaccess.com/');
    expect(JSON.stringify(attrs)).not.toContain('schenanigans');
  });

  test('with no declared team (state from before the prop) the live domain host stands in', () => {
    expect(toAttributes(live(), 'acct', 'x', undefined)?.teamDomain).toBe(
      'example.cloudflareaccess.com',
    );
  });

  test('the client secret the wire carries reaches neither the parse nor the attributes', () => {
    expect(JSON.stringify(live())).not.toContain('must-never-be-read');
    expect(
      JSON.stringify(toAttributes(live(), 'acct', 'x', 'example.cloudflareaccess.com')),
    ).not.toContain('must-never-be-read');
  });

  test('an app with no client id is not describable', () => {
    expect(toAttributes(live({ saas_app: { auth_type: 'oidc' } }), 'a', 'x', 'e.test.com')).toBe(
      undefined,
    );
  });

  test('a declared team that disagrees with the app is refused', () => {
    expect(checkTeam('other.cloudflareaccess.com', live())?.message).toContain(
      'example.cloudflareaccess.com',
    );
    expect(checkTeam('EXAMPLE.cloudflareaccess.com', live())).toBeUndefined();
  });

  test('with no domain reported, a declaration that moves the recorded team is refused', () => {
    const noDomain = live({ domain: undefined });
    expect(
      checkTeam('other.cloudflareaccess.com', noDomain, 'example.cloudflareaccess.com')?.message,
    ).toContain('issuer cannot move');
    expect(
      checkTeam('EXAMPLE.cloudflareaccess.com', noDomain, 'example.cloudflareaccess.com'),
    ).toBeUndefined();
    // Nothing recorded (first create, cold adoption): nothing to compare, the declaration stands.
    expect(checkTeam('other.cloudflareaccess.com', noDomain)).toBeUndefined();
  });
});

describe('needsSync', () => {
  test('is false for a live app that matches the declaration', () => {
    expect(needsSync(publicClient(), live(), 'Headlamp')).toBe(false);
  });

  test('flips on redirect URIs, grants, PKCE flag, lifetime, policies and name', () => {
    const props = publicClient();
    const withSaas = (patch: object) => ({ ...props, saasApp: { ...props.saasApp, ...patch } });
    expect(needsSync(withSaas({ redirectUris: ['https://x.test/cb'] }), live(), 'Headlamp')).toBe(
      true,
    );
    expect(needsSync(withSaas({ grantTypes: ['authorization_code'] }), live(), 'Headlamp')).toBe(
      true,
    );
    expect(needsSync(withSaas({ allowPkceWithoutClientSecret: false }), live(), 'Headlamp')).toBe(
      true,
    );
    expect(needsSync(withSaas({ accessTokenLifetime: '1h' }), live(), 'Headlamp')).toBe(true);
    expect(needsSync(withSaas({ refreshTokenLifetime: '30d' }), live(), 'Headlamp')).toBe(true);
    expect(needsSync({ ...props, policies: ['a', 'b'] }, live(), 'Headlamp')).toBe(true);
    expect(needsSync(props, live(), 'Renamed')).toBe(true);
  });

  test('ignores the order of sets', () => {
    const props = publicClient();
    const reordered = {
      ...props,
      saasApp: { ...props.saasApp, scopes: ['groups', 'openid', 'email'] as const },
    };
    expect(needsSync(reordered, live(), 'Headlamp')).toBe(false);
  });
});

describe('policy order is part of the declaration', () => {
  const ranked = (policies: Array<{ id: string; precedence?: number }>) =>
    live({ policies: policies });

  test('the same policies in a different order are drift', () => {
    const props = publicClient({ policies: ['policy-a', 'policy-b'] });
    const inOrder = ranked([
      { id: 'policy-a', precedence: 1 },
      { id: 'policy-b', precedence: 2 },
    ]);
    const swapped = ranked([
      { id: 'policy-b', precedence: 1 },
      { id: 'policy-a', precedence: 2 },
    ]);
    expect(needsSync(props, inOrder, 'Headlamp')).toBe(false);
    expect(needsSync(props, swapped, 'Headlamp')).toBe(true);
    expect(needsSync({ ...props, policies: ['policy-b', 'policy-a'] }, inOrder, 'Headlamp')).toBe(
      true,
    );
  });

  test('the live order is the API precedence, whatever order the array arrives in', () => {
    const arrival = ranked([
      { id: 'policy-b', precedence: 2 },
      { id: 'policy-a', precedence: 1 },
    ]);
    expect(arrival.policyIds).toEqual(['policy-a', 'policy-b']);
    expect(
      needsSync(publicClient({ policies: ['policy-a', 'policy-b'] }), arrival, 'Headlamp'),
    ).toBe(false);
  });

  test('without a precedence on every entry the array order stands', () => {
    const partial = ranked([{ id: 'policy-b', precedence: 2 }, { id: 'policy-a' }]);
    expect(partial.policyIds).toEqual(['policy-b', 'policy-a']);
  });

  test('a missing or extra policy is drift too', () => {
    const one = ranked([{ id: 'policy-a', precedence: 1 }]);
    expect(needsSync(publicClient({ policies: ['policy-a', 'policy-b'] }), one, 'Headlamp')).toBe(
      true,
    );
    expect(needsSync(publicClient({ policies: [] }), one, 'Headlamp')).toBe(true);
  });
});

describe('writeBody', () => {
  test('a public client sends the PKCE grant and the flag, and no client secret field', () => {
    const body = writeBody(publicClient(), 'Headlamp');
    expect(body.saasApp).toMatchObject({
      authType: 'oidc',
      grantTypes: ['authorization_code_with_pkce'],
      allowPkceWithoutClientSecret: true,
    });
    expect(JSON.stringify(body)).not.toContain('secret":"');
    expect(body.sessionDuration).toBe('24h');
    expect(body.appLauncherVisible).toBe(false);
  });

  test('the flag defaults to a confidential client', () => {
    const props = publicClient();
    const { allowPkceWithoutClientSecret: _flag, ...rest } = props.saasApp;
    expect(writeBody({ ...props, saasApp: rest }, 'x').saasApp.allowPkceWithoutClientSecret).toBe(
      false,
    );
  });
});
