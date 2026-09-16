/**
 * The parity report: roles.yaml's expansion against a snapshot of production, field by field, with
 * names resolved to IDs through source (b) — the same solver `permissionGroupsFromLiveRoles` runs.
 *
 * ★ PURE, SO THE CHECK IS THE PROVIDER'S OWN CODE AND NOT A SECOND OPINION. `differences` is the
 *   function diff and reconcile call, `solveGroups` is the function source (b) calls, and the
 *   expansion is the one declareCloudflareRoles declares. A report that re-implemented any of them
 *   could agree with production while the provider did not.
 *
 * ⛔ EVERY LINE IS A PROBLEM OR SAYS `(none)`. An empty section is printed as `(none)` rather than
 *   omitted, so a report that silently skipped a mount cannot pass for one that found nothing.
 */
import { catalogProblems, descriptionProblem } from './cloudflare-parity-catalog.ts';
import type { SnapshotMount } from './cloudflare-parity-snapshot.ts';
import {
  describeProblems,
  observationsOf,
  solveGroups,
} from './cloudflare-permission-groups-solve.ts';
import { type WirePolicy, atEveryScope, resolvePolicies } from './cloudflare-policy.ts';
import { differences } from './cloudflare-role-form.ts';
import type { ExpandedRole } from './cloudflare-roles-expand.ts';

export interface ParityReport {
  readonly lines: string[];
  readonly problems: number;
}

const section = (lines: string[], title: string, items: readonly string[]) => {
  if (items.length === 0) {
    lines.push(`  ${title}: (none)`);
    return;
  }
  lines.push(`  ${title}:`);
  for (const item of items) lines.push(`    ${item}`);
};

/** Source (b) over the snapshot, per account — groups by account, and a summary line each. */
const solveAccounts = (
  declared: ReadonlyMap<string, readonly ExpandedRole[]>,
  snapshot: readonly SnapshotMount[],
  lines: string[],
) => {
  const live = new Map<string, readonly WirePolicy[]>();
  for (const mount of snapshot) {
    for (const [name, role] of mount.roles) {
      if (role.policies !== undefined) live.set(`${mount.mount}/${name}`, role.policies);
    }
  }
  const byAccount = new Map<string, ExpandedRole[]>();
  for (const roles of declared.values()) {
    for (const role of roles) {
      byAccount.set(role.account, [...(byAccount.get(role.account) ?? []), role]);
    }
  }
  const groups = new Map<string, ReadonlyMap<string, string>>();
  let problems = 0;
  lines.push('permission groups — source (b), bootstrapped from live roles:');
  for (const [account, roles] of [...byAccount].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const observations = observationsOf(roles, live);
    const solved = solveGroups(observations);
    const found = describeProblems(solved);
    problems += found.length;
    groups.set(account, solved.groups);
    lines.push(
      `  ${account}: ${String(solved.groups.size)} names resolved from ` +
        `${String(observations.length)} policy entries; ${String(solved.ambiguous.length)} ` +
        `ambiguous, ${String(solved.unresolved.length)} unresolved, ` +
        `${String(solved.contradicted.length)} contradicted`,
    );
    for (const problem of found) lines.push(`    ${problem}`);
  }
  return { groups, problems };
};

/**
 * ★ `observedPrefixes` NAMES ROLES THAT ARE READ, NEVER DECLARED OR WRITTEN — anyauth's, by Tim's
 *   call on 2026-09-14 ("read only, in case we decide to adopt it later"). A live role under one of
 *   them is listed in its own section and is not a problem; one that is NOT under a prefix and not
 *   declared still is, so the carve-out cannot hide an unrelated stray.
 */
export const parityReport = (
  declared: ReadonlyMap<string, readonly ExpandedRole[]>,
  snapshot: readonly SnapshotMount[],
  observedPrefixes: readonly string[] = [],
): ParityReport => {
  const lines: string[] = [];
  const solved = solveAccounts(declared, snapshot, lines);
  let problems = solved.problems;
  let compared = 0;
  let identical = 0;
  let observedTotal = 0;
  const isObserved = (name: string) => observedPrefixes.some((prefix) => name.startsWith(prefix));
  const mounts = [...new Set([...declared.keys(), ...snapshot.map((m) => m.mount)])].sort();
  for (const mount of mounts) {
    const roles = declared.get(mount) ?? [];
    const live = snapshot.find((m) => m.mount === mount);
    const liveRoles = live?.roles ?? new Map();
    const names = new Set(roles.map((role) => role.name));
    const onlyDeclared = roles.map((role) => role.name).filter((name) => !liveRoles.has(name));
    const undeclared = [...liveRoles.keys()].filter((name) => !names.has(name)).sort();
    const observed = undeclared.filter(isObserved);
    const onlyLive = undeclared.filter((name) => !isObserved(name));
    observedTotal += observed.length;
    const differing: string[] = [];
    for (const role of roles) {
      const have = liveRoles.get(role.name);
      if (have === undefined) continue;
      compared += 1;
      // ⚠️ `atEveryScope`: the solver reads live roles, which carry ids and no scopes, so the only
      //   thing it can say about a name is one id — offered at whatever scope an entry asks for.
      const ids = solved.groups.get(role.account) ?? new Map<string, string>();
      const { missing, policies } = resolvePolicies(role.policies, atEveryScope(ids));
      if (missing.length > 0) {
        differing.push(`${role.name}: unresolved groups ${missing.join(', ')}`);
        continue;
      }
      const found = differences(role, policies, have);
      if (found.length === 0) identical += 1;
      for (const d of found)
        differing.push(`${role.name}: ${d.field}: want ${d.want} / have ${d.have}`);
    }
    const catalog = catalogProblems(mount, roles, live);
    const description = descriptionProblem(mount, roles, live, observed.length);
    const catalogCount = live?.catalog?.roles.size;
    lines.push(
      '',
      `${mount}: ${String(roles.length)} declared, ${String(liveRoles.size)} live, ` +
        `${catalogCount === undefined ? 'no' : String(catalogCount)} in catalog`,
    );
    section(lines, 'only in roles.yaml', onlyDeclared);
    section(lines, 'only live', onlyLive);
    // ★ Listed, never counted: these are read-only by decision, not drift.
    section(lines, 'observed read-only (not declared, never written)', observed);
    section(lines, 'fields differing', differing);
    section(lines, 'catalog', catalog);
    section(lines, 'mount description', description === undefined ? [] : [description]);
    problems +=
      onlyDeclared.length +
      onlyLive.length +
      differing.length +
      catalog.length +
      (description === undefined ? 0 : 1);
  }
  lines.push(
    '',
    `roles compared: ${String(compared)}, identical after resolution: ${String(identical)}`,
    `observed read-only: ${String(observedTotal)}`,
    `${String(problems)} problem(s)`,
  );
  return { lines, problems };
};
