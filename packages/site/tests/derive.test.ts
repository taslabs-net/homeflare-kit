/**
 * derive(): the names it builds, and the keys it refuses.
 * ⛔ The exact strings asserted here are what consumer stacks create. A change to one is a
 *   rename in every repo, which is why deriveVersion exists.
 */
import { describe, expect, test } from 'bun:test';
import {
  SiteError,
  decodeSite,
  derive,
  inventory,
  pinnedPrincipalIssues,
  pins,
  unknownPrincipals,
} from '../src/index.ts';
import { example, withPath } from './fixture.ts';

const site = decodeSite(example());
const d = derive(site);

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (error) {
    if (error instanceof SiteError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return 'no error';
}

describe('vault addresses', () => {
  test('host, API host and the three ways in', () => {
    expect(d.vault.host).toBe('v.example.com');
    expect(d.vault.apiHost).toBe('api.v.example.com');
    expect(d.vault.publicAddr).toBe('https://api.v.example.com');
    expect(d.vault.meshAddr).toBe('https://198.18.0.2:8200');
    expect(d.vault.lanAddr).toBe('http://hub.mgmt.example.com:8200');
  });

  test('OIDC redirects: the UI callback on the vault host, then the CLI listener', () => {
    // ★ Matches what the live OpenBao OIDC client registers (UI host, not the API host).
    expect(d.vault.oidcRedirects).toEqual([
      'https://v.example.com/ui/vault/auth/oidc/oidc/callback',
      'http://localhost:8250/oidc/callback',
    ]);
  });
});

describe('zones, hosts, addresses', () => {
  test('zone suffixes, with apex as the reserved key', () => {
    expect(d.mgmtZone).toBe('mgmt.example.com');
    expect(d.zones).toEqual({ mgmt: 'mgmt.example.com', lab: 'lab.example.com' });
    expect(d.zone('apex')).toBe('example.com');
  });

  test('host FQDNs and leg addresses', () => {
    expect(d.host('n2')).toBe('n2.mgmt.example.com');
    expect(d.host('docs')).toBe('docs.example.com');
    expect(d.address('n2', 'lab')).toBe('198.51.100.12');
    expect(d.address('backup', 'storage')).toBe('198.18.4.7');
  });

  test('host numbers count from the network address, beyond one octet', () => {
    const wide = withPath(example(), ['networks', 'lab'], '198.18.0.0/16');
    const built = derive(decodeSite(withPath(wide, ['hosts', 'n1', 'legs', 'lab'], 300)));
    expect(built.address('n1', 'lab')).toBe('198.18.1.44');
  });
});

describe('Access, products, services, clusters, mounts', () => {
  test('Access team URLs', () => {
    expect(d.access.teamDomain).toBe('https://example-team.cloudflareaccess.com');
    expect(d.access.certsUrl).toBe(
      'https://example-team.cloudflareaccess.com/cdn-cgi/access/certs',
    );
  });

  test('products: key, label or own domain', () => {
    expect(d.productHost('alerts')).toBe('alerts.example.com');
    expect(d.productHost('wiki')).toBe('kb.example.com');
    expect(d.productUrl('shop')).toBe('https://shop.example.net');
  });

  test('services and cluster members', () => {
    expect(d.serviceUrl('grafana')).toBe('http://hub.mgmt.example.com:3000');
    expect(d.clusterMembers('c1')).toEqual([
      'n1.mgmt.example.com',
      'n2.mgmt.example.com',
      'n3.mgmt.example.com',
    ]);
  });

  test('cloudflare-<alias>-<surface> mounts', () => {
    expect(d.cloudflareMounts).toEqual([
      'cloudflare-main-dns',
      'cloudflare-main-platform',
      'cloudflare-main-security',
      'cloudflare-main-access',
      'cloudflare-lab-dns',
    ]);
    expect(d.cloudflareMount('main', 'access')).toBe('cloudflare-main-access');
    expect(d.accountId('lab')).toBe('00000000000000000000000000000002');
  });
});

describe('unknown keys throw — no plausible fallback', () => {
  const cases: readonly [string, () => unknown, string][] = [
    ['product', () => d.productHost('typo'), 'unknown product "typo"'],
    ['service', () => d.serviceUrl('typo'), 'unknown service "typo"'],
    ['zone', () => d.zone('typo'), 'unknown zone "typo"'],
    ['host', () => d.host('typo'), 'unknown host "typo"'],
    ['leg', () => d.address('docs', 'mgmt'), 'unknown network leg of host "docs"'],
    ['cluster', () => d.clusterMembers('typo'), 'unknown cluster "typo"'],
    ['account', () => d.cloudflareMount('typo', 'dns'), 'unknown cloudflare account "typo"'],
    ['surface', () => d.cloudflareMount('lab', 'security'), 'unknown surface of account "lab"'],
    ['pin', () => pins(site).name('typo'), 'unknown pinned name "typo"'],
  ];

  for (const [name, call, message] of cases) {
    test(name, () => {
      const result = codeOf(call);
      expect(result.startsWith('unknown-key: ')).toBe(true);
      expect(result).toContain(message);
    });
  }

  test('the refusal lists what is declared', () => {
    expect(codeOf(() => d.productHost('typo'))).toContain('declared: alerts, shop, wiki');
  });
});

describe('pins are read, never computed', () => {
  test('each table by key', () => {
    const p = pins(site);
    expect(p.name('alerts.d1')).toBe('example-alerts');
    expect(p.certificate('vault.origin')).toEqual(['v.example.com', 'api.v.example.com']);
    expect(p.adopted('backup.datastore')).toBe('example-store');
    expect(p.policy('access.admins')).toEqual(['alice@example.com']);
    expect(p.principals('ssh-host.host')).toContain('198.51.100.11');
  });

  test('a pinned certificate does NOT follow an apex change', () => {
    // ⛔ The whole point: reissuing an adopted certificate revokes the one in service.
    const moved = decodeSite(withPath(example(), ['apex'], 'example.org'));
    expect(pins(moved).certificate('vault.origin')).toEqual(['v.example.com', 'api.v.example.com']);
    expect(derive(moved).vault.host).toBe('v.example.org');
  });
});

describe('inventory', () => {
  test('knows host keys, aliases, FQDNs and leg addresses', () => {
    const known = inventory(site);
    for (const name of [
      'gateway',
      'n3',
      'backup.lab.example.com',
      '203.0.113.250',
      'example.com',
    ]) {
      expect(known.has(name)).toBe(true);
    }
  });

  test('the example principal list is a subset of it', () => {
    expect(pinnedPrincipalIssues(site)).toEqual([]);
  });

  test('a stale principal is reported, not generated away', () => {
    expect(unknownPrincipals(site, ['n1', '192.0.2.99'])).toEqual(['192.0.2.99']);
    const stale = withPath(example(), ['pinned', 'sshPrincipals', 'ssh-host.host'], ['n9']);
    expect(pinnedPrincipalIssues(decodeSite(stale))).toEqual([
      'pinned.sshPrincipals.ssh-host.host: "n9" is not in the inventory',
    ]);
  });
});
