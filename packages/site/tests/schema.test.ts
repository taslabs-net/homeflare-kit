/**
 * Decode: the example decodes; every bad input fails NAMING ITS PATH.
 * ★ A refusal that says "invalid site" sends someone reading a 200-line JSON file by eye.
 *   One that says `networks.lab: Expected the network address` is a one-line fix.
 */
import { describe, expect, test } from 'bun:test';
import { SiteError, decodeSite } from '../src/index.ts';
import { example, withPath } from './fixture.ts';

function issuesOf(input: unknown): readonly string[] {
  try {
    decodeSite(input);
  } catch (error) {
    if (error instanceof SiteError) return error.issues;
    throw error;
  }
  throw new Error('expected the decode to fail');
}

describe('the example', () => {
  test('decodes, with defaults applied', () => {
    const site = decodeSite(example());
    expect(site.kind).toBe('example');
    expect(site.vault.port).toBe(8200);
    expect(site.vault.namespace).toBe('');
    expect(site.vault.oidcMount).toBe('oidc');
    expect(site.vault.cliCallbackPort).toBe(8250);
  });

  test('pinned tables default to empty when absent', () => {
    const site = decodeSite(withPath(example(), ['pinned'], undefined));
    expect(site.pinned).toEqual({
      names: {},
      certificates: {},
      adopted: {},
      policies: {},
      sshPrincipals: {},
    });
  });
});

describe('bad inputs name their path', () => {
  const cases: readonly [string, readonly (string | number)[], unknown, string][] = [
    ['apex with capitals', ['apex'], 'Example.com', 'apex:'],
    ['a one-label apex', ['apex'], 'localhost', 'apex:'],
    ['an unknown format', ['version'], 2, 'version:'],
    ['an unknown kind', ['kind'], 'prod', 'kind:'],
    ['a host address as a network', ['networks', 'lab'], '198.51.100.5/24', 'networks.lab:'],
    ['a /31', ['networks', 'lab'], '198.51.100.0/31', 'networks.lab:'],
    ['an octet over 255', ['vault', 'meshAddress'], '198.18.0.256', 'vault.meshAddress:'],
    ['a port of 0', ['vault', 'lan', 'port'], 0, 'vault.lan.port:'],
    ['a guessed scheme', ['services', 'grafana', 'scheme'], 'tcp', 'services.grafana.scheme:'],
    [
      'a short account id',
      ['cloudflare', 'accounts', 'main', 'id'],
      'abc',
      'cloudflare.accounts.main.id:',
    ],
    ['a relative estate root', ['paths', 'estateRoot'], 'opt/example', 'paths.estateRoot:'],
    ['a blank cluster name', ['vault', 'clusterName'], ' ', 'vault.clusterName:'],
    [
      'a principal with a comma',
      ['pinned', 'sshPrincipals', 'ssh-host.host', 0],
      'a,b',
      'pinned.sshPrincipals["ssh-host.host"].0:',
    ],
    [
      'an empty certificate list',
      ['pinned', 'certificates', 'vault.origin'],
      [],
      'pinned.certificates["vault.origin"]',
    ],
    ['no mgmt zone', ['zones', 'mgmt'], undefined, 'zones.mgmt:'],
    ['a non-semver deriveVersion', ['deriveVersion'], 'latest', 'deriveVersion:'],
  ];

  for (const [name, path, value, expected] of cases) {
    test(name, () => {
      const issues = issuesOf(withPath(example(), path, value));
      expect(issues.some((line) => line.startsWith(expected))).toBe(true);
    });
  }

  test('every problem is reported at once, not just the first', () => {
    let input = withPath(example(), ['apex'], 'Bad');
    input = withPath(input, ['vault', 'port'], 70_000);
    const issues = issuesOf(input);
    expect(issues.some((l) => l.startsWith('apex:'))).toBe(true);
    expect(issues.some((l) => l.startsWith('vault.port:'))).toBe(true);
  });
});

describe('unknown keys are refused, never dropped', () => {
  test('a misspelt field', () => {
    const issues = issuesOf(withPath(example(), ['vault', 'namepsace'], 'x'));
    expect(issues).toContain(
      'vault.namepsace: unknown key (a misspelt field, or a record key that is not a lowercase label)',
    );
  });

  test('a record key that is not a label', () => {
    // ⚠️ Measured: under the default `ignore` this entry vanished and the site decoded one
    //   network short. It must be an error.
    const issues = issuesOf(withPath(example(), ['networks', 'Mgmt2'], '192.0.2.0/24'));
    expect(issues.some((l) => l.startsWith('networks.Mgmt2: unknown key'))).toBe(true);
  });
});

describe('references name the broken field', () => {
  const cases: readonly [string, readonly (string | number)[], unknown, string][] = [
    ['a host in an undeclared zone', ['hosts', 'hub', 'zone'], 'nope', 'hosts.hub.zone:'],
    ['a leg on an undeclared network', ['hosts', 'hub', 'legs', 'nope'], 5, 'hosts.hub.legs.nope:'],
    [
      'a host number past the broadcast',
      ['hosts', 'hub', 'legs', 'mgmt'],
      255,
      'hosts.hub.legs.mgmt:',
    ],
    [
      'a service on an unknown host',
      ['services', 'grafana', 'host'],
      'nope',
      'services.grafana.host:',
    ],
    [
      'a cluster member with no zone',
      ['hosts', 'node-a', 'zone'],
      undefined,
      'clusters.c1.members.0:',
    ],
    ['the LAN proxy on an unknown host', ['vault', 'lan', 'host'], 'nope', 'vault.lan.host:'],
    ['a product with label AND domain', ['products', 'shop', 'label'], 'store', 'products.shop:'],
    ['the reserved zone key', ['zones', 'apex'], 'top', 'zones.apex:'],
    [
      'a repeated surface',
      ['cloudflare', 'accounts', 'lab', 'surfaces'],
      ['dns', 'dns'],
      'cloudflare.accounts.lab.surfaces:',
    ],
  ];

  for (const [name, path, value, expected] of cases) {
    test(name, () => {
      let code = '';
      let issues: readonly string[] = [];
      try {
        decodeSite(withPath(example(), path, value));
      } catch (error) {
        if (!(error instanceof SiteError)) throw error;
        code = error.code;
        issues = error.issues;
      }
      expect(code).toBe('reference');
      expect(issues.some((line) => line.startsWith(expected))).toBe(true);
    });
  }
});
