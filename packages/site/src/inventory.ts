/**
 * The inventory: every name and address the site declares for a machine.
 *
 * ★ PINNED LISTS ARE CHECKED AGAINST IT, NOT GENERATED FROM IT. A principal list is a
 *   subset of the inventory — an assertion a consumer's test makes — never a rendering of
 *   it. The difference matters on the bad day: when a leg is renamed, a generated list
 *   silently drops the old address, and the break-glass path goes with it (measured on
 *   this estate 2026-08-12: "name is not a listed principal" on the only way in).
 */
import { joinPath } from './decode.ts';
import { derive } from './derive.ts';
import type { Site } from './schema.ts';

/** Apex, zones, the vault's names, and every host key, alias, FQDN and leg address. */
export function inventory(site: Site): ReadonlySet<string> {
  const derived = derive(site);
  const names = new Set<string>([
    site.apex,
    ...Object.values(derived.zones),
    derived.vault.host,
    derived.vault.apiHost,
    site.vault.meshAddress,
  ]);
  for (const [key, host] of Object.entries(site.hosts)) {
    names.add(key);
    for (const alias of host.aliases ?? []) names.add(alias);
    const built = derived.hosts[key];
    if (built?.fqdn !== undefined) names.add(built.fqdn);
    for (const address of Object.values(built?.addresses ?? {})) names.add(address);
  }
  return names;
}

/** The entries of `list` the inventory does not know. Empty means `list` is a subset. */
export function unknownPrincipals(site: Site, list: readonly string[]): readonly string[] {
  const known = inventory(site);
  return list.filter((entry) => !known.has(entry));
}

/**
 * Every pinned SSH principal the inventory does not know, as `path: entry` lines.
 * ⚠️ A consumer TEST calls this; loading does not. A stale principal is a finding to fix
 *   in review, not a reason to refuse a break-glass plan at 3am.
 */
export function pinnedPrincipalIssues(site: Site): readonly string[] {
  const issues: string[] = [];
  for (const [key, list] of Object.entries(site.pinned.sshPrincipals)) {
    for (const entry of unknownPrincipals(site, list)) {
      // ★ Bracketed like decode errors: `ssh-host.host` is one key, not two levels.
      const path = joinPath(['pinned', 'sshPrincipals', key]);
      issues.push(`${path}: "${entry}" is not in the inventory`);
    }
  }
  return issues;
}
