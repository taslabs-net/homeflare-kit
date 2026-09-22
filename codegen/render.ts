/**
 * Rendering the constraint tables: one generated file per vendor area, plus the merged index.
 *
 * ★ SPLIT BY THE VENDOR'S OWN FIRST PATH SEGMENT, not by size. `pve-cluster.ts` is one file
 *   because `/cluster` is one area of the API, so a reader who has the vendor's docs open knows
 *   where to look — and the house cap is enforced below rather than fitted to.
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

/** `pve:POST /cluster/sdn/zones` -> `cluster`. One generated file per vendor area. */
export const areaOf = (key: string): string => (key.split(' ')[1] ?? '/').split('/')[1] ?? 'root';

export const constName = (product: string, area: string): string =>
  `${product.toUpperCase()}_${area.toUpperCase().replaceAll('-', '_')}_CONSTRAINTS`;

const header = (entry: ManifestEntry, area: string, covered: number, total: number): string =>
  `/**
 * Generated ${entry.product} parameter constraints for \`/${area}\` — DO NOT EDIT BY HAND.
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
