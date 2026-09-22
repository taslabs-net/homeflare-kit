/**
 * Rendering the NetBox constraint tables and the coverage report.
 *
 * ★ A SEPARATE RENDERER FROM `render.ts`, AND THE REASON IS THE PROSE. Every ⚠️ in the Proxmox
 *   headers is a fact about Proxmox — a `format` name PVE validates server-side, a PBS pattern
 *   dialect, the `pve:`/`pbs:` prefix collision. Reusing that file would mean either printing
 *   those claims over NetBox tables, where they are false, or hollowing the headers out until
 *   they say nothing. The DATA path (`emit.ts`, the digest) is shared; only the words differ.
 */
import { type EmittedParam, digest } from './emit.ts';

export interface NetboxManifestEntry {
  readonly id: string;
  readonly product: string;
  readonly version: string;
  readonly sourceRole: string;
  readonly sourcePath: string;
  readonly sha256: string;
}

export const CAP = 250;

/**
 * `netbox:POST /api/ipam/prefixes/` -> `ipam`. One generated file per NetBox app.
 *
 * ⚠️ SEGMENT TWO, NOT SEGMENT ONE. Every NetBox path starts `/api/`, so `render.ts`'s `areaOf`
 *   would file all 684 write endpoints under one area named `api` and the cap would be hit
 *   immediately. The vendor's own app labels — `dcim`, `ipam`, `tenancy`, `virtualization` — are
 *   the split a reader with the NetBox docs open expects.
 */
export const areaOf = (key: string): string => (key.split(' ')[1] ?? '/').split('/')[2] ?? 'root';

export const constName = (area: string): string =>
  `NETBOX_${area.toUpperCase().replaceAll('-', '_')}_CONSTRAINTS`;

const header = (entry: NetboxManifestEntry, area: string, covered: number, total: number): string =>
  `/**
 * Generated ${entry.product} request-body constraints for \`/api/${area}\` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/netbox.ts
 * Manifest entry: \`${entry.id}\` — ${entry.product} ${entry.version}
 *   sha256 ${entry.sha256.slice(0, 16)}, ${entry.sourceRole}
 *   ${entry.sourcePath}
 *
 * ${covered} of this product's ${total} POST/PUT/PATCH/DELETE endpoints are tabled across all
 * areas: the ones this package writes to, named in its own source. Every other vendor write
 * endpoint is UNTABLED and therefore unchecked at plan time.
 *
 * ⚠️ A \`patternSource\` with no \`pattern\` beside it could NOT be carried into a JavaScript
 *   RegExp faithfully — Python's \`\\w\` is Unicode and JavaScript's is ASCII
 *   (codegen/py-pattern.ts). It is recorded and NOT enforced.
 * ⚠️ A FOREIGN KEY CARRIES ONLY ITS TYPE. \`tenant\`, \`vlan\`, \`role\` and friends are
 *   \`integer|object\` in the schema, and the related object's own rules do not govern them.
 */
import type { EndpointConstraints } from '../../constraints.ts';
`;

export const render = (
  entry: NetboxManifestEntry,
  area: string,
  tables: Readonly<Record<string, Readonly<Record<string, EmittedParam>>>>,
  covered: number,
  total: number,
): string => {
  // ★ ONE LINE PER PARAMETER, for the same reason `render.ts` does it: a regeneration against a
  //   newer NetBox has to read as "this bound moved", not as one enormous line that changed.
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
export const ${constName(area)}: Readonly<Record<string, EndpointConstraints>> = {
${body}
};
`;
};

/**
 * ⛔ THE MERGE IS GENERATED TOO — a hand-written index is one forgotten import away from a table
 *   that exists on disk and is never consulted, which reads exactly like no constraint at all.
 */
export const renderIndex = (
  modules: readonly { readonly file: string; readonly constant: string }[],
  overall: string,
): string =>
  `/**
 * Every generated NetBox constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/netbox.ts
 *
 * ⚠️ EVERY KEY IS PREFIXED \`netbox:\` FOR THE SAME REASON THE PROXMOX TABLES ARE PREFIXED. One
 *   estate runs several vendors and the reader is shared; an unprefixed \`POST /api/…\` would be
 *   one vendor away from colliding.
 */
import type { EndpointConstraints } from '../../constraints.ts';
${modules.map((m) => `import { ${m.constant} } from './${m.file}';`).join('\n')}

export const NETBOX_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
${modules.map((m) => `  ...${m.constant},`).join('\n')}
};

/**
 * sha256 of the merged table, truncated.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so reformatting is not a stale generation while
 *   changing a 200 to a 201 by hand is. \`tests/netbox-manifest.test.ts\` recomputes it.
 */
export const NETBOX_CONSTRAINTS_DIGEST = '${overall}';
`;

export interface CoverageRow {
  readonly key: string;
  readonly source: string;
  readonly params: number;
  readonly enforced: number;
  readonly recordedOnly: number;
}

export interface CoverageInput {
  readonly entry: NetboxManifestEntry;
  readonly rows: readonly CoverageRow[];
  readonly writeEndpoints: number;
  readonly writePaths: number;
  readonly apps: readonly { readonly app: string; readonly endpoints: number }[];
  readonly digest: string;
}

/** ⚠️ Re-exported so the driver hashes with the same function the tables are digested by. */
export { digest };
