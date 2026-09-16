/**
 * ⚠️ TEMPORARY — DELETE WITH `permissionGroupsFromLiveRoles` (cloudflare-permission-groups.ts) ONCE
 *   `GET <mount>/permission-groups` IS DEPLOYED ON THE CLOUDFLARE ENGINE.
 *
 * The pure half of the bootstrap: recover permission-group name → ID from roles whose names are
 * declared (roles.yaml) and whose IDs are live (the engine).
 *
 * ★ WHY IT EXISTS AT ALL. apply-roles.py resolved names with
 *   `GET /accounts/<id>/tokens/permission_groups` (cfhf.py:147-148) under a Cloudflare parent
 *   credential, which agents may not use. The engine is gaining an endpoint that answers under its
 *   own credential; until it ships, the only other witness is the roles apply-roles.py already
 *   wrote, each pairing a list of names with a list of IDs.
 *
 * ⛔ NEVER A GUESS.
 *   1. Every entry with exactly one name and one ID binds that pair.
 *   2. Then, until nothing changes: an entry left with exactly ONE name and ONE ID not yet known
 *      binds those two.
 *   3. Once settled, every entry is checked against the map: one that declares a known name without
 *      carrying that name's ID CONTRADICTS it.
 *   POSITIONS ARE NEVER USED, even where the Python kept yaml order — a hand-edited role would
 *   otherwise teach the map a wrong pair in silence. A name bound to two IDs, or an ID bound to two
 *   names, is AMBIGUOUS; a name nothing isolates is UNRESOLVED; and a contradiction is exactly
 *   that. Each is an error for the whole account, not a best effort.
 *
 * ⛔ THE CONTRADICTION CHECK IS THE ONE THAT BITES, AND IT WAS FOUND BY A TEST, NOT BY DESIGN. When a
 *   name has ONE single-group witness and that role was edited by hand, step 1 learns the edited ID,
 *   and the multi-group roles carrying the real one merely fail to eliminate. Unchecked, diff would
 *   then plan every one of those roles as an update TO THE EDITED ID — a hand edit propagated by the
 *   tool meant to catch it. Which side is wrong is unknowable here; only Cloudflare knows.
 * ⚠️ THE PRICE: SOURCE (b) CANNOT PLAN A GROUP ADDED TO, OR SWAPPED IN, AN EXISTING ROLE. That edit
 *   looks exactly like the hand edit above — declared names disagreeing with live IDs — so it fails
 *   the account. New roles and removed groups still plan. (b) is for ADOPTION; changes wait for (a).
 *
 * ⛔ IT KEYS BY NAME AND THE ENGINE SOURCE KEYS BY (NAME, SCOPE) — DELIBERATELY UNCHANGED, 2026-09-15.
 *   A live role is a list of ids with no scopes, so a name is all this can key on; seven names the
 *   engine lists TWICE (once account-scoped, once zone-scoped) are one entry here, holding whichever
 *   id the estate happens to carry. cloudflare-policy.ts `atEveryScope` is where that map is widened
 *   to the scoped key the resolver now uses, and it is the honest shape of this blind spot: this file
 *   is the OFFLINE PARITY PROOF against a production export, and rewriting it to a key it cannot
 *   observe would make it agree with the engine by construction instead of by measurement.
 *
 * ⚠️ WHAT IT CANNOT CATCH. The names come from roles.yaml itself, so a group misnamed CONSISTENTLY
 *   — every use of `DNS Read` spelled `DNS Reed` — pairs the wrong name with the right ID and
 *   resolves cleanly, where Cloudflare would have refused it. cloudflare/parity.ts cross-checks the
 *   catalog documents apply-roles.py wrote, which hold names that DID resolve against Cloudflare at
 *   the last apply, for exactly that reason. The engine endpoint has no such blind spot.
 */
import type { WirePolicy } from './cloudflare-policy.ts';
import type { ExpandedRole } from './cloudflare-roles-expand.ts';

export interface Observation {
  /** `<mount>/<role>[<entry>]`, for messages. */
  readonly where: string;
  readonly names: readonly string[];
  readonly ids: readonly string[];
}

export interface Conflict {
  /** `name` bound to several IDs, or `id` bound to several names. */
  readonly kind: 'id' | 'name';
  readonly value: string;
  readonly bound: readonly string[];
}

/** An entry declaring `name`, whose ID the map knows as `id`, without carrying `id`. */
export interface Contradiction {
  readonly where: string;
  readonly name: string;
  readonly id: string;
}

export interface Solved {
  readonly groups: ReadonlyMap<string, string>;
  readonly ambiguous: readonly Conflict[];
  readonly unresolved: readonly string[];
  readonly contradicted: readonly Contradiction[];
}

/**
 * One observation per declared entry whose resource matches exactly one live entry of that role.
 *
 * ★ PAIRED BY RESOURCE, NOT BY POSITION. A zone role's account groups sit on the account resource
 *   and nowhere else, whatever order the entries were stored in. An entry that shares its resource
 *   with a sibling, or finds no single live match, observes nothing — the diff reports it instead.
 */
export const observationsOf = (
  declared: readonly ExpandedRole[],
  live: ReadonlyMap<string, readonly WirePolicy[]>,
): Observation[] =>
  declared.flatMap((role) => {
    const entries = live.get(`${role.mount}/${role.name}`);
    if (entries === undefined) return [];
    return role.policies.flatMap((policy, i) => {
      const twins = role.policies.filter((other) => other.resource === policy.resource);
      const matching = entries.filter(
        (entry) => Object.keys(entry.resources).length === 1 && policy.resource in entry.resources,
      );
      const [only] = matching;
      if (twins.length !== 1 || matching.length !== 1 || only === undefined) return [];
      return [
        {
          ids: only.groupIds,
          names: policy.groups,
          where: `${role.mount}/${role.name}[${String(i)}]`,
        },
      ];
    });
  });

const unique = (items: readonly string[]) => [...new Set(items)];

export const solveGroups = (observations: readonly Observation[]): Solved => {
  const idsOf = new Map<string, Set<string>>();
  const namesOf = new Map<string, Set<string>>();
  const bind = (name: string, id: string) => {
    const ids = idsOf.get(name) ?? new Set<string>();
    const fresh = !ids.has(id);
    idsOf.set(name, ids.add(id));
    namesOf.set(id, (namesOf.get(id) ?? new Set<string>()).add(name));
    return fresh;
  };
  /** Known only while the name has one ID and that ID has only this name. */
  const known = (name: string) => {
    const ids = idsOf.get(name);
    const [id] = ids ?? [];
    return ids?.size === 1 && id !== undefined && namesOf.get(id)?.size === 1 ? id : undefined;
  };

  const shaped = observations.map((o) => ({ ids: unique(o.ids), names: unique(o.names) }));
  // 1. Every single-group entry binds, unconditionally — so a contradicting one is RECORDED as a
  //    conflict rather than skipped because its name happened to be learned first.
  for (const { ids, names } of shaped) {
    const [name] = names;
    const [id] = ids;
    if (names.length === 1 && ids.length === 1 && name !== undefined && id !== undefined) {
      bind(name, id);
    }
  }
  // 2. Elimination. ⚠️ A count mismatch proves nothing about which name is which ID, so it is skipped.
  for (let changed = true; changed;) {
    changed = false;
    for (const { ids, names } of shaped) {
      if (names.length !== ids.length) continue;
      const knownIds = new Set(names.map(known));
      const openNames = names.filter((name) => known(name) === undefined);
      const openIds = ids.filter((id) => !knownIds.has(id));
      const [name] = openNames;
      const [id] = openIds;
      if (
        openNames.length === 1 &&
        openIds.length === 1 &&
        name !== undefined &&
        id !== undefined
      ) {
        changed = bind(name, id) || changed;
      }
    }
  }
  // 3. Contradictions — including entries step 2 skipped for a count mismatch.
  const contradicted: Contradiction[] = [];
  for (const o of observations) {
    for (const name of unique(o.names)) {
      const id = known(name);
      if (id !== undefined && !o.ids.includes(id)) contradicted.push({ id, name, where: o.where });
    }
  }

  const groups = new Map<string, string>();
  const ambiguous: Conflict[] = [];
  const unresolved: string[] = [];
  for (const name of unique(observations.flatMap((o) => o.names)).sort()) {
    const ids = idsOf.get(name);
    const id = known(name);
    if (ids === undefined) unresolved.push(name);
    else if (ids.size > 1) ambiguous.push({ bound: [...ids].sort(), kind: 'name', value: name });
    else if (id !== undefined) groups.set(name, id);
  }
  for (const [id, names] of [...namesOf].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (names.size > 1) ambiguous.push({ bound: [...names].sort(), kind: 'id', value: id });
  }
  return { ambiguous, contradicted, groups, unresolved };
};

/** Every conflict, unresolved name and contradiction, one line each. */
export const describeProblems = (solved: Solved): string[] => [
  ...solved.ambiguous.map((c) =>
    c.kind === 'name'
      ? `ambiguous: name ${JSON.stringify(c.value)} is bound to ids ${c.bound.join(', ')}`
      : `ambiguous: id ${c.value} is bound to names ${c.bound.map((n) => JSON.stringify(n)).join(', ')}`,
  ),
  ...solved.unresolved.map(
    (name) => `unresolved: no live role isolates ${JSON.stringify(name)} to one id`,
  ),
  ...solved.contradicted.map(
    (c) => `contradicted: ${c.where} declares ${JSON.stringify(c.name)} but lacks its id ${c.id}`,
  ),
];
