/**
 * Checks that span fields: every zone, host and network a value names is declared.
 *
 * ★ WHY NOT IN THE SCHEMA. A struct-level filter reports one issue at the struct's own
 *   path; these checks want to name the exact field (`services.grafana.host`), and they
 *   want to report every broken reference at once rather than the first.
 */
import { lastHostNumber } from './net.ts';
import type { Site } from './schema.ts';

/** The zone key that means the apex itself. Reserved: a site may not declare it. */
export const APEX_ZONE = 'apex';

function hostHasZone(site: Site, host: string): boolean {
  return Object.hasOwn(site.hosts, host) && site.hosts[host]?.zone !== undefined;
}

function checkHosts(site: Site, issues: string[]): void {
  for (const [key, host] of Object.entries(site.hosts)) {
    const zone = host.zone;
    if (zone !== undefined && zone !== APEX_ZONE && !Object.hasOwn(site.zones, zone)) {
      issues.push(`hosts.${key}.zone: "${zone}" is not a declared zone or "${APEX_ZONE}"`);
    }
    for (const [network, number] of Object.entries(host.legs ?? {})) {
      const cidr = site.networks[network];
      if (cidr === undefined) {
        issues.push(`hosts.${key}.legs.${network}: "${network}" is not a declared network`);
      } else if (number > lastHostNumber(cidr)) {
        issues.push(`hosts.${key}.legs.${network}: host number ${number} does not fit ${network}`);
      }
    }
  }
}

function checkZonedHost(site: Site, path: string, host: string, issues: string[]): void {
  if (!Object.hasOwn(site.hosts, host)) {
    issues.push(`${path}: "${host}" is not a declared host`);
  } else if (!hostHasZone(site, host)) {
    issues.push(`${path}: host "${host}" has no zone, so it has no hostname`);
  }
}

function checkAccounts(site: Site, issues: string[]): void {
  for (const [alias, account] of Object.entries(site.cloudflare.accounts)) {
    const seen = new Set<string>();
    for (const surface of account.surfaces) {
      // ⚠️ A repeated surface derives the same mount name twice; the second declaration
      //   would silently be the same mount, so a typo'd duplicate is refused here.
      if (seen.has(surface)) {
        issues.push(`cloudflare.accounts.${alias}.surfaces: "${surface}" is listed twice`);
      }
      seen.add(surface);
    }
  }
}

/** Every broken reference in `site`, each naming its path. Empty when the site is sound. */
export function referenceIssues(site: Site): readonly string[] {
  const issues: string[] = [];

  if (Object.hasOwn(site.zones, APEX_ZONE)) {
    issues.push(`zones.${APEX_ZONE}: reserved — a host with zone "${APEX_ZONE}" sits on the apex`);
  }
  checkHosts(site, issues);
  for (const [key, cluster] of Object.entries(site.clusters)) {
    for (const [i, member] of cluster.members.entries()) {
      checkZonedHost(site, `clusters.${key}.members.${i}`, member, issues);
    }
  }
  for (const [key, product] of Object.entries(site.products)) {
    if (product.label !== undefined && product.domain !== undefined) {
      issues.push(`products.${key}: set label OR domain, not both`);
    }
  }
  for (const [key, service] of Object.entries(site.services)) {
    checkZonedHost(site, `services.${key}.host`, service.host, issues);
  }
  checkZonedHost(site, 'vault.lan.host', site.vault.lan.host, issues);
  checkAccounts(site, issues);

  return issues;
}
