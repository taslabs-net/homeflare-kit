/**
 * The coverage model: every PVE and PBS endpoint that can CHANGE state, against the Resource that
 * owns it — or `null`, which is most of them.
 *
 * ★ WHY THIS EXISTS. `homeflare-proxmox` counts config CLASSES by hand and gets a number nobody
 *   can reproduce. This counts ENDPOINTS from the vendor's own schema, so the number is a fact
 *   about a named product version rather than a claim in a document.
 */
import { type Endpoint, type Manifest, entry, isWrite, short } from './api-schema.ts';
import { OWNERSHIP, type System } from './proxmox-ownership.ts';

export type Row = {
  readonly method: string;
  readonly path: string;
  /** The Alchemy resource kind that writes here, or null. */
  readonly owner: string | null;
  /** Parameters on this endpoint carrying a vendor rule our generated types drop. */
  readonly unenforced: readonly string[];
  readonly parameters: number;
};

export type Totals = {
  readonly writeEndpoints: number;
  readonly ownedWriteEndpoints: number;
  readonly writePaths: number;
  readonly ownedWritePaths: number;
  /** Unenforced parameters across every write endpoint. */
  readonly unenforcedParams: number;
  /** Unenforced parameters on the write endpoints a Resource owns — the exposed blast radius. */
  readonly ownedUnenforcedParams: number;
};

export type SystemCoverage = {
  readonly system: System;
  readonly product: string;
  readonly version: string;
  readonly sha256Short: string;
  readonly totals: Totals;
  readonly rows: readonly Row[];
};

export type Finding = {
  readonly resource: string;
  readonly system: System;
  readonly file: string;
  readonly method: string;
  readonly path: string;
  readonly why: string;
};

export type Coverage = {
  readonly generator: { readonly script: string; readonly version: string };
  readonly systems: readonly SystemCoverage[];
  /** Endpoints the source says the vendor does not implement, and that the schema confirms absent. */
  readonly refuted: readonly Finding[];
  /** Endpoints a Resource really calls that the vendor does not implement. Defects. */
  readonly broken: readonly Finding[];
  /** Manifest entries with no generated output yet — recorded so the gap list stops guessing. */
  readonly availableUnused: readonly {
    readonly id: string;
    readonly product: string;
    readonly version: string;
  }[];
};

const ownerIndex = (system: System): Map<string, string> => {
  const index = new Map<string, string>();
  for (const o of OWNERSHIP) {
    if (o.system !== system) continue;
    for (const w of o.writes) {
      const key = `${w.method} ${w.path}`;
      const already = index.get(key);
      // ⚠️ Two Resources writing the same endpoint is a real possibility, not an error. Name both
      //   rather than letting whichever sorts last win silently.
      index.set(key, already === undefined ? o.resource : `${already}, ${o.resource}`);
    }
  }
  return index;
};

const totals = (rows: readonly Row[]): Totals => {
  const paths = new Set(rows.map((r) => r.path));
  const ownedPaths = new Set(rows.filter((r) => r.owner !== null).map((r) => r.path));
  return {
    ownedUnenforcedParams: rows.reduce(
      (n, r) => n + (r.owner === null ? 0 : r.unenforced.length),
      0,
    ),
    unenforcedParams: rows.reduce((n, r) => n + r.unenforced.length, 0),
    ownedWriteEndpoints: rows.filter((r) => r.owner !== null).length,
    ownedWritePaths: ownedPaths.size,
    writeEndpoints: rows.length,
    writePaths: paths.size,
  };
};

export const systemCoverage = (
  system: System,
  manifest: Manifest,
  all: readonly Endpoint[],
): SystemCoverage => {
  const e = entry(manifest, `proxmox/${system}`);
  const owners = ownerIndex(system);
  const rows: readonly Row[] = all.filter(isWrite).map((ep) => ({
    method: ep.method,
    owner: owners.get(`${ep.method} ${ep.path}`) ?? null,
    parameters: ep.parameters,
    path: ep.path,
    unenforced: ep.unenforced,
  }));
  return {
    product: e.product,
    rows,
    sha256Short: short(e.sha256),
    system,
    totals: totals(rows),
    version: e.version,
  };
};

const findings = (key: 'refuted' | 'broken'): readonly Finding[] =>
  OWNERSHIP.flatMap((o) =>
    (o[key] ?? []).map((n) => ({
      file: o.file,
      method: n.method,
      path: n.path,
      resource: o.resource,
      system: o.system,
      why: n.why,
    })),
  );

export const buildCoverage = (
  manifest: Manifest,
  schemas: Readonly<Record<System, readonly Endpoint[]>>,
): Coverage => ({
  availableUnused: manifest.entries
    .filter((e) => !e.id.startsWith('proxmox/'))
    .map((e) => ({ id: e.id, product: e.product, version: e.version })),
  broken: findings('broken'),
  generator: manifest.generator,
  refuted: findings('refuted'),
  systems: [
    systemCoverage('pve', manifest, schemas.pve),
    systemCoverage('pbs', manifest, schemas.pbs),
  ],
});
