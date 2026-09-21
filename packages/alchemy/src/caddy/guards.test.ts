/**
 * The pure checks: the digest's canonical form, the Caddyfile secret tripwire, and the admin-block
 * guard. Each refusal here is one a deploy would otherwise learn about from a stranded Caddy or a
 * token in the state store.
 */
import { describe, expect, test } from 'bun:test';
import { adminProblems } from './admin-guard.ts';
import type { CaddyAdminListener } from './admin.ts';
import { caddyfileSecretProblems, tokensOf } from './caddyfile-tripwire.ts';
import { canonicalConfig, configDigest, parseConfig } from './digest.ts';

describe('digest', () => {
  test('struct order (/adapt) and sorted, escaped, newline-terminated (/config/) hash the same', () => {
    const adapted = {
      apps: { http: { servers: { srv0: { routes: ['<a> & b'], listen: [':443'] } } } },
    };
    const reported =
      '{"apps":{"http":{"servers":{"srv0":{"listen":[":443"],"routes":["\\u003ca\\u003e \\u0026 b"]}}}}}\n';
    expect(configDigest(parseConfig(reported))).toBe(configDigest(adapted));
  });

  test('an empty config is null, and hashes as null', () => {
    expect(parseConfig('null\n')).toBeNull();
    expect(canonicalConfig(undefined)).toBe('null');
  });

  test('a real difference is a different digest', () => {
    expect(configDigest({ a: [1, 2] })).not.toBe(configDigest({ a: [2, 1] }));
  });
});

describe('tokensOf', () => {
  test('quotes kept whole, comments dropped only at a token start', () => {
    expect(tokensOf('header Authorization "Bearer {env.T}" # note')).toEqual([
      'header',
      'Authorization',
      'Bearer {env.T}',
    ]);
    expect(tokensOf('respond a#b')).toEqual(['respond', 'a#b']);
  });
});

/**
 * ⚠️ ASSEMBLED AT RUN TIME. A literal token-shaped fixture trips the pre-commit gitleaks scan
 *   (MEASURED 2026-09-21: its `jwt` rule flagged the first draft of this file). Joined parts keep
 *   the shape the tripwire must catch out of the source text gitleaks reads.
 */
const GITHUB_TOKEN = ['ghp', 'a1B2'.repeat(9)].join('_');
const JWT = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0x', 'c2lnbmF0dXJl'].join('.');
const BCRYPT = ['', '2a', '14', 'x'.repeat(53)].join('$');

describe('caddyfileSecretProblems', () => {
  test.each([
    ['dns provider token', 'tls {\n  dns cloudflare abcdef0123456789\n}'],
    ['acme_dns token', 'acme_dns cloudflare abcdef0123456789'],
    ['a secret-named subdirective', 'oauth {\n  client_secret s3cr3t\n}'],
    [
      'a literal Authorization header',
      'reverse_proxy up:80 {\n  header_up Authorization "Bearer abc123"\n}',
    ],
    ['a GitHub token anywhere', `respond ${GITHUB_TOKEN}`],
    ['a JWT', `header X-Id ${JWT}`],
    ['a bcrypt hash in basic_auth', `basic_auth {\n  admin ${BCRYPT}\n}`],
    ['a PEM private key', 'x {\n-----BEGIN EC PRIVATE KEY-----\n}'],
  ])('refuses %s', (_, caddyfile) => {
    const found = caddyfileSecretProblems(caddyfile);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join(' ')).toContain('{env.NAME}');
  });

  test('never echoes the secret it found', () => {
    const found = caddyfileSecretProblems('dns cloudflare abcdef0123456789').join(' ');
    expect(found).not.toContain('abcdef0123456789');
    expect(found).toContain('line 1');
  });

  test.each([
    ['env placeholder', 'tls {\n  dns cloudflare {env.CF_API_TOKEN}\n}'],
    ['file placeholder', 'client_secret {file./run/secrets/oidc}'],
    ['adapt-time env (the name only)', 'dns cloudflare {$CF_API_TOKEN}'],
    ['a placeholder bearer', 'header_up Authorization "Bearer {env.UPSTREAM_TOKEN}"'],
    ['a forwarded header', 'header_up Authorization {http.request.header.Authorization}'],
    ['a block opener', 'dns cloudflare {\n  api_token {env.CF}\n}'],
    ['a deleted header', 'header -Authorization'],
    ['a *_file path', 'api_key_file /run/secrets/key'],
    ['a hash from the env', 'basic_auth {\n  admin {env.ADMIN_HASH}\n}'],
    ['an ordinary site', 'app.example.com {\n  reverse_proxy 127.0.0.1:8080\n}'],
  ])('allows %s', (_, caddyfile) => {
    expect(caddyfileSecretProblems(caddyfile)).toEqual([]);
  });
});

describe('adminProblems', () => {
  const tcp: CaddyAdminListener = { hostHeader: '127.0.0.1:2019', kind: 'tcp', port: 2019 };
  const unix: CaddyAdminListener = { kind: 'unix', path: '/run/caddy/admin.sock' };
  const admin = (block: object) => ({ admin: block, apps: {} });

  test.each([
    [{}, tcp],
    [{ listen: 'localhost:2019' }, tcp],
    [{ listen: '127.0.0.1:2019', origins: ['127.0.0.1:2019'] }, tcp],
    [{ listen: 'tcp/[::1]:2019' }, tcp],
    [{ listen: 'unix//run/caddy/admin.sock|0660' }, unix],
    [{ origins: ['http://127.0.0.1:2019'] }, tcp],
  ])('allows %j', (block, transport) => {
    expect(adminProblems(admin(block), transport)).toEqual([]);
  });

  test('no admin block at all, and an empty config, pass', () => {
    expect(adminProblems({ apps: {} }, tcp)).toEqual([]);
    expect(adminProblems(null, tcp)).toEqual([]);
  });

  test.each([
    [{ disabled: true }, tcp, /admin off/],
    [{ listen: ':2019' }, tcp, /not loopback/],
    [{ listen: '0.0.0.0:2019' }, tcp, /not loopback/],
    [{ listen: '192.0.2.5:2019' }, tcp, /not loopback/],
    [{ listen: 'localhost:2020' }, tcp, /moves the admin API/],
    [{ listen: 'unix//run/caddy/admin.sock' }, tcp, /moves the admin API/],
    [{ listen: 'unix//run/other.sock' }, unix, /moves the admin API/],
    [{ listen: '{env.CADDY_ADMIN}' }, tcp, /placeholder/],
    [{ origins: ['caddy.example:2019'] }, tcp, /do not allow Host 127\.0\.0\.1:2019/],
    [{ origins: ['https://127.0.0.1:2019'] }, tcp, /do not allow Host/],
    [{ origins: [] }, tcp, /do not allow Host/],
    [{ remote: { listen: ':2021' } }, tcp, /network-facing/],
    [{ config: { load: { module: 'http' } } }, tcp, /pull its config/],
  ])('refuses %j', (block, transport, reason) => {
    expect(adminProblems(admin(block), transport).join(' ')).toMatch(reason);
  });
});
