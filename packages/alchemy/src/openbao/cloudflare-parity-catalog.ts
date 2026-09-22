/**
 * The two things apply-roles.py wrote BESIDE the roles, checked against the expansion: each mount's
 * KV catalog document (apply-roles.py:48-82) and each mount's description (apply-roles.py:85-95).
 *
 * ★ WHY THE CATALOG IS CHECKED AT ALL: IT IS THE BOOTSTRAP'S INDEPENDENT WITNESS. Its `permissions`
 *   are the NAMES apply-roles.py resolved against Cloudflare's own permission-group list at its last
 *   --apply — resolve_groups fails the role on any name Cloudflare does not know
 *   (apply-roles.py:29-45, :144-149). So a catalog that agrees with roles.yaml means the names the
 *   bootstrap pairs with live IDs were real Cloudflare names then, which closes the blind spot
 *   cloudflare-permission-groups-solve.ts names.
 *
 * ⚠️ `generated` IS NOT COMPARED. It is the wall-clock time of the last --apply
 *   (apply-roles.py:55), so it differs on every run by construction — a note for whoever declares
 *   the catalog next: as written it can never plan noop.
 */
import type { SnapshotMount } from './cloudflare-parity-snapshot.ts';
import type { CatalogView, ExpandedRole } from './cloudflare-roles-expand.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The catalog entry apply-roles.py:58-62 would write for a role, in the document's own keys. */
const catalogEntry = (view: CatalogView) => ({
  description: view.description,
  max_ttl: view.maxTtl,
  permissions: view.permissions,
  ttl: view.ttl,
  zone: view.zone,
});

/** The whole document's non-role fields (apply-roles.py:65-67, :72-76). */
const expectedFields = (mount: string, declared: readonly ExpandedRole[], count: number) => {
  const [first] = declared;
  return {
    account: first?.account,
    account_id: first?.accountId,
    mint_path: `${mount}/creds/<role>`,
    mount,
    role_count: String(count),
    surface: mount.split('-').at(-1),
  };
};

export const catalogProblems = (
  mount: string,
  declared: readonly ExpandedRole[],
  snapshot: SnapshotMount | undefined,
): string[] => {
  const catalog = snapshot?.catalog;
  if (catalog === undefined) return ['no catalog document in the snapshot'];
  const problems: string[] = [];
  const live = snapshot?.roles ?? new Map();
  for (const name of [...live.keys()].sort()) {
    if (!catalog.roles.has(name)) problems.push(`live but not in the catalog: ${name}`);
  }
  for (const name of [...catalog.roles.keys()].sort()) {
    if (!live.has(name)) problems.push(`in the catalog but not live: ${name}`);
  }
  for (const role of declared) {
    const entry = catalog.roles.get(role.name);
    if (entry === undefined) {
      problems.push(`in roles.yaml but not in the catalog: ${role.name}`);
      continue;
    }
    for (const [field, want] of Object.entries(catalogEntry(role.catalog))) {
      if (!same(entry[field], want)) {
        const have = JSON.stringify(entry[field]);
        problems.push(
          `${role.name}: catalog ${field}: want ${JSON.stringify(want)} / have ${have}`,
        );
      }
    }
  }
  const fields = expectedFields(mount, declared, catalog.roles.size);
  for (const [field, want] of Object.entries(fields)) {
    if (!same(catalog.fields[field], want)) {
      const have = JSON.stringify(catalog.fields[field]);
      problems.push(`catalog field ${field}: want ${JSON.stringify(want)} / have ${have}`);
    }
  }
  return problems;
};

/**
 * apply-roles.py:91-95 — `Cloudflare <surface> credentials, <n> roles. Catalog: …`, n being the
 * EXPANDED count, not the live one.
 *
 * ⚠️ `observedCount` IS ADDED BACK IN. The Python expanded over every zone, anyauth included, so its
 *   count carries the roles Alchemy now only observes (OBSERVED_ROLE_PREFIXES in cloudflare-zones.ts).
 *   Leaving them out would report a description drift that is really a scope decision.
 */
export const descriptionProblem = (
  mount: string,
  declared: readonly ExpandedRole[],
  snapshot: SnapshotMount | undefined,
  observedCount = 0,
): string | undefined => {
  const surface = mount.split('-').at(-1) ?? '';
  const count = declared.length + observedCount;
  const want = `Cloudflare ${surface} credentials, ${String(count)} roles. Catalog: kv/cloudflare/catalog/${mount}`;
  const have = snapshot?.description;
  return have === want
    ? undefined
    : `mount description: want ${JSON.stringify(want)} / have ${JSON.stringify(have)}`;
};
