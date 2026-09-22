/**
 * Rendering the constraint tables: one generated file per vendor area, plus the merged index.
 *
 * ★ SPLIT BY THE VENDOR'S OWN AREA, not by size. `pve-nodes-ceph.ts` is one file because
 *   `/nodes/{node}/ceph` is one area of the API, so a reader who has the vendor's docs open knows
 *   where to look — and the house cap is enforced below rather than fitted to. `areaOf` says
 *   which segment that is and why.
 */
import type { EmittedParam } from './emit.ts';

export interface ManifestEntry {
  readonly id: string;
  readonly product: string;
  readonly version: string;
  readonly sourceRole: string;
  readonly sourcePath: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly consumedBy: string | null;
}

export type Tables = Readonly<Record<string, Readonly<Record<string, EmittedParam>>>>;

export const CAP = 250;

/**
 * `pve:POST /cluster/sdn/zones` -> `cluster-sdn`; `pve:POST /nodes/{node}/ceph/pool` ->
 * `nodes-ceph`; `pbs:POST /config/prune` -> `config`. One generated file per vendor area.
 *
 * ⛔ `/cluster` AND `/nodes/{node}` ARE ROUTES, NOT AREAS, AND THAT IS PVE'S OWN TREE RATHER THAN
 *   A SIZE FIX. Its API viewer expands `/cluster` into backup, ceph, firewall, ha, metrics,
 *   notifications, replication and sdn, and `/nodes/{node}` into ceph, lxc, qemu, network and
 *   disks; each of those is an area a reader can hold in their head, while the two parents are
 *   most of the product. `/access`, `/pools`, `/storage` and PBS's `/config` are areas already and
 *   stay whole. The house cap is still enforced in constraints.ts and still throws — this rule is
 *   the DECISION about where the seams are, not a loop that keeps cutting until things fit.
 * ⚠️ PATH PARAMETERS ARE SKIPPED WHEN CHOOSING THE AREA, because `{node}` names nothing.
 */
const ROUTES = new Set(['cluster', 'nodes']);

export const areaOf = (key: string): string => {
  const parts = (key.split(' ')[1] ?? '/')
    .split('/')
    .filter((part) => part !== '' && !part.startsWith('{'));
  const head = parts[0] ?? 'root';
  return ROUTES.has(head) ? `${head}-${parts[1] ?? 'root'}` : head;
};

/**
 * How the header names the area. `nodes-ceph` is really `/nodes/{node}/ceph`; say so.
 *
 * ⚠️ ONLY A ROUTE PREFIX IS UNJOINED. A vendor area whose own name carries a hyphen —
 *   `/cluster/bulk-action` would be `cluster-bulk-action` — must not have that hyphen read as a
 *   path separator, so the split is driven by the same `ROUTES` set that made the name.
 */
const areaLabel = (area: string): string => {
  for (const route of ROUTES) {
    if (!area.startsWith(`${route}-`)) continue;
    const rest = area.slice(route.length + 1);
    return route === 'nodes' ? `/nodes/{node}/${rest}` : `/${route}/${rest}`;
  }
  return `/${area}`;
};

export const constName = (product: string, area: string): string =>
  `${product.toUpperCase()}_${area.toUpperCase().replaceAll('-', '_')}_CONSTRAINTS`;

const header = (entry: ManifestEntry, area: string, covered: number, total: number): string =>
  `/**
 * Generated ${entry.product} parameter constraints for \`${areaLabel(area)}\` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: \`${entry.id}\` — ${entry.product} ${entry.version}
 *   sha256 ${entry.sha256.slice(0, 16)}, read on a ${entry.sourceRole} from
 *   ${entry.sourcePath}
 *
 * ${covered} of this product's ${total} POST/PUT endpoints are tabled across all areas: the ones
 * this package writes to, named in its own source. Every other vendor write endpoint is UNTABLED
 * and therefore unchecked at plan time.
 *
 * ⚠️ A \`patternSource\` with no \`pattern\` beside it is a rule that could NOT be carried into a
 *   JavaScript RegExp faithfully (codegen/pattern.ts). It is recorded and NOT enforced.
 * ⚠️ \`pattern\` IS NOT THE VENDOR'S SPELLING. For PVE it is anchored, because PVE applies
 *   \`m/^$pattern$/\` itself (JSONSchema.pm); for PBS it is the vendor's own, which already
 *   carries its anchors. \`patternSource\` is the spelling to quote at a human — param-rules.ts.
 * ⚠️ \`each: true\` means the value rules describe every ELEMENT of a repeated key, because the
 *   parameter is an array and stated its limits on \`items\`.
 */
import type { EndpointConstraints } from '../../constraints.ts';
`;

export const render = (
  entry: ManifestEntry,
  product: string,
  area: string,
  tables: Readonly<Record<string, Readonly<Record<string, EmittedParam>>>>,
  covered: number,
  total: number,
): string => {
  // ★ ONE LINE PER PARAMETER. `**/generated/**` is in oxfmt's ignore list, so nothing reflows this
  //   afterwards — and a regeneration against a newer schema has to read as "this bound moved",
  //   not as one four-thousand-character line that changed.
  const body = Object.keys(tables)
    .sort()
    .map((key) => {
      const rows = Object.entries(tables[key] ?? {})
        .map(([param, rule]) => `    ${JSON.stringify(param)}: ${JSON.stringify(rule)},`)
        .join('\n');
      return `  ${JSON.stringify(key)}: {${rows === '' ? '' : `\n${rows}\n  `}},`;
    })
    .join('\n');
  return `${header(entry, area, covered, total)}
export const ${constName(product, area)}: Readonly<Record<string, EndpointConstraints>> = {
${body}
};
`;
};

/**
 * ⛔ THE MERGE IS GENERATED TOO. A hand-written index is one forgotten import away from a table
 *   that exists on disk and is never consulted — which reads exactly like no constraint at all.
 */
export const renderIndex = (
  modules: readonly { readonly file: string; readonly constant: string }[],
  overall: string,
): string =>
  `/**
 * Every generated Proxmox constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 *
 * ⚠️ MERGING IS SAFE ONLY BECAUSE EVERY KEY IS PREFIXED \`pve:\`/\`pbs:\`. PVE and PBS both publish
 *   \`PUT /access/acl\` and \`PUT /access/password\` with DIFFERENT rules; an unprefixed merge would
 *   silently enforce one product's limits on the other's objects.
 */
import type { EndpointConstraints } from '../../constraints.ts';
${modules.map((m) => `import { ${m.constant} } from './${m.file}';`).join('\n')}

export const PROXMOX_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
${modules.map((m) => `  ...${m.constant},`).join('\n')}
};

/**
 * sha256 of the merged table, truncated.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so reformatting is not a stale generation while
 *   changing a 128 to a 129 by hand is. \`tests/schema-manifest.test.ts\` recomputes it.
 */
export const PROXMOX_CONSTRAINTS_DIGEST = '${overall}';
`;
