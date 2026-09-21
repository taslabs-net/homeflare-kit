/**
 * `derive(site)`: every hostname, address, zone suffix, Access URL, OIDC redirect and
 * vault mount name, built from base values. Pure — same site in, same names out.
 *
 * ⛔ DERIVE ONLY WHAT FOLLOWS A RULE. Physical names, certificate hostnames, adopted ids
 *   and policy / principal lists are PINNED (see pins.ts). Anything added here must be
 *   a pure function of base values, or the relativity test stops meaning anything.
 *
 * ⛔ UNKNOWN KEYS THROW. `productHost('typo')` refuses, naming what is declared. It never
 *   falls back to `typo.<apex>`: a plausible default is how a typo becomes a DNS record.
 *
 * ★ The result is plain data plus lookup methods. `JSON.stringify(derive(site))` is the
 *   whole rendering (methods drop out), which is what the leak and relativity tests read.
 */
import { SiteError, lookup, unknownKey } from './errors.ts';
import { addressOn } from './net.ts';
import { APEX_ZONE } from './references.ts';
import type { Site } from './schema.ts';

export interface DerivedHost {
  /** `<key>.<zone>`; absent when the host declares no zone. */
  readonly fqdn?: string;
  /** Network key → address on that network. */
  readonly addresses: Readonly<Record<string, string>>;
}

export interface DerivedVault {
  /** `<vault-host>`: the browser / UI hostname. */
  readonly host: string;
  /** `<vault-api-host>`: the public API hostname. */
  readonly apiHost: string;
  /** `https://<vault-api-host>` — the public API. Humans; machines use Mesh or the LAN. */
  readonly publicAddr: string;
  /** `https://<mesh address>:<port>` — machines over the private Mesh path. */
  readonly meshAddr: string;
  /** The LAN pass-through proxy, as a `BAO_ADDR`. */
  readonly lanAddr: string;
  readonly namespace: string;
  /** Browser callback on `<vault-host>`, then the CLI's localhost listener. */
  readonly oidcRedirects: readonly string[];
}

export interface DerivedAccess {
  readonly team: string;
  /**
   * `https://<team>.cloudflareaccess.com`. ★ Named for `verifyAccessJwt`'s `teamDomain`
   *   option in `@homeflare/cloudflare`, so it passes straight through.
   */
  readonly teamDomain: string;
  /** The JWKS endpoint Access signs with. */
  readonly certsUrl: string;
}

export interface Derived {
  readonly apex: string;
  /** Zone key → FQDN (`mgmt` → `mgmt.<apex>`). */
  readonly zones: Readonly<Record<string, string>>;
  /** `<mgmt-zone>`. */
  readonly mgmtZone: string;
  readonly vault: DerivedVault;
  readonly access: DerivedAccess;
  readonly hosts: Readonly<Record<string, DerivedHost>>;
  /** Product key → public hostname. */
  readonly products: Readonly<Record<string, string>>;
  /** Service key → URL. */
  readonly services: Readonly<Record<string, string>>;
  /** Cluster key → member FQDNs, in declared order. */
  readonly clusters: Readonly<Record<string, readonly string[]>>;
  /** Every `cloudflare-<alias>-<surface>` mount, in declared order. */
  readonly cloudflareMounts: readonly string[];

  /** A zone's FQDN. `"apex"` is the apex itself. */
  zone(key: string): string;
  /** A host's FQDN. Throws when the host is unknown or has no zone. */
  host(key: string): string;
  /** A host's address on a network. Throws when either is unknown or not a leg. */
  address(host: string, network: string): string;
  productHost(key: string): string;
  /** `https://<productHost>`. */
  productUrl(key: string): string;
  serviceUrl(key: string): string;
  clusterMembers(key: string): readonly string[];
  /** Throws when the alias is unknown or that account does not list the surface. */
  cloudflareMount(alias: string, surface: string): string;
  accountId(alias: string): string;
}

function zoneOf(site: Site, key: string): string {
  if (key === APEX_ZONE) return site.apex;
  return `${lookup('zone', site.zones, key)}.${site.apex}`;
}

function deriveHosts(site: Site): Record<string, DerivedHost> {
  const out: Record<string, DerivedHost> = {};
  for (const [key, host] of Object.entries(site.hosts)) {
    const addresses: Record<string, string> = {};
    for (const [network, number] of Object.entries(host.legs ?? {})) {
      addresses[network] = addressOn(lookup('network', site.networks, network), number);
    }
    out[key] = {
      ...(host.zone === undefined ? {} : { fqdn: `${key}.${zoneOf(site, host.zone)}` }),
      addresses,
    };
  }
  return out;
}

function mapRecord<V, R>(record: Readonly<Record<string, V>>, f: (value: V, key: string) => R) {
  const out: Record<string, R> = {};
  for (const [key, value] of Object.entries(record)) out[key] = f(value, key);
  return out;
}

export function derive(site: Site): Derived {
  const hosts = deriveHosts(site);
  const hostFqdn = (key: string): string => {
    const fqdn = lookup('host', hosts, key).fqdn;
    if (fqdn === undefined) {
      throw new SiteError('unknown-key', `host "${key}" has no zone, so it has no hostname`);
    }
    return fqdn;
  };

  const vaultHost = `${site.vault.label}.${site.apex}`;
  const apiHost = `${site.vault.apiLabel}.${vaultHost}`;
  const { lan } = site.vault;
  const teamDomain = `https://${site.cloudflare.access.team}.cloudflareaccess.com`;

  const products = mapRecord(
    site.products,
    (p, key) => p.domain ?? `${p.label ?? key}.${site.apex}`,
  );
  const services = mapRecord(site.services, (s) => `${s.scheme}://${hostFqdn(s.host)}:${s.port}`);
  const clusters = mapRecord(site.clusters, (c) => c.members.map(hostFqdn));
  const accounts = site.cloudflare.accounts;
  const cloudflareMounts = Object.entries(accounts).flatMap(([alias, account]) =>
    account.surfaces.map((surface) => `cloudflare-${alias}-${surface}`),
  );

  return {
    apex: site.apex,
    zones: mapRecord(site.zones, (_label, key) => zoneOf(site, key)),
    mgmtZone: zoneOf(site, 'mgmt'),
    vault: {
      host: vaultHost,
      apiHost,
      publicAddr: `https://${apiHost}`,
      meshAddr: `https://${site.vault.meshAddress}:${site.vault.port}`,
      lanAddr: `${lan.scheme}://${hostFqdn(lan.host)}:${lan.port}`,
      namespace: site.vault.namespace,
      oidcRedirects: [
        `https://${vaultHost}/ui/vault/auth/${site.vault.oidcMount}/oidc/callback`,
        `http://localhost:${site.vault.cliCallbackPort}/oidc/callback`,
      ],
    },
    access: {
      team: site.cloudflare.access.team,
      teamDomain,
      certsUrl: `${teamDomain}/cdn-cgi/access/certs`,
    },
    hosts,
    products,
    services,
    clusters,
    cloudflareMounts,

    zone: (key) => zoneOf(site, key),
    host: hostFqdn,
    address: (host, network) => {
      const addresses = lookup('host', hosts, host).addresses;
      if (!Object.hasOwn(addresses, network))
        unknownKey(`network leg of host "${host}"`, network, Object.keys(addresses));
      return addresses[network] as string;
    },
    productHost: (key) => lookup('product', products, key),
    productUrl: (key) => `https://${lookup('product', products, key)}`,
    serviceUrl: (key) => lookup('service', services, key),
    clusterMembers: (key) => lookup('cluster', clusters, key),
    cloudflareMount: (alias, surface) => {
      const account = lookup('cloudflare account', accounts, alias);
      if (!account.surfaces.includes(surface)) {
        unknownKey(`surface of account "${alias}"`, surface, account.surfaces);
      }
      return `cloudflare-${alias}-${surface}`;
    },
    accountId: (alias) => lookup('cloudflare account', accounts, alias).id,
  };
}
