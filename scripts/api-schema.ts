/**
 * Read a vendor API schema from the local cache, after proving it is the one the manifest names.
 *
 * ⛔ NOTHING HERE GUESSES. A constraint that is not in the vendor document does not exist as far as
 *   this pipeline is concerned, and a document whose sha256 does not match `schemas/manifest.json`
 *   is refused rather than used — otherwise "generated from the schema" would mean "generated from
 *   whatever happened to be on this laptop".
 *
 * ⚠️ THE RAW BLOBS ARE NOT IN GIT. They are 4.2 MB and 1.5 MB of vendor-shipped documentation. The
 *   manifest's sha256 reproduces them exactly from the host that serves them; see `schemas/README.md`.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { enforcedKinds } from './api-enforced.ts';
import { resolveParameters } from '../codegen/parameters.ts';

export type ManifestEntry = {
  readonly id: string;
  readonly vendor: string;
  readonly product: string;
  readonly version: string;
  readonly sourceHostRole: string;
  readonly sourcePath: string;
  readonly fetch: string;
  readonly cacheFile: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly obtainedAt: string;
  readonly verifiedAt: string;
};

export type Manifest = {
  readonly schemaVersion: number;
  readonly generator: { readonly script: string; readonly version: string };
  readonly entries: readonly ManifestEntry[];
};

/** Where the raw documents live. Overridable so CI and a second machine are not hard-coded. */
export const cacheDir = (): string =>
  process.env['HF_SCHEMA_CACHE'] ?? join(homedir(), '.cache', 'homeflare', 'schemas');

export const readManifest = async (repoRoot: string): Promise<Manifest> =>
  (await Bun.file(join(repoRoot, 'schemas', 'manifest.json')).json()) as Manifest;

export const entry = (manifest: Manifest, id: string): ManifestEntry => {
  const found = manifest.entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(`schemas/manifest.json has no entry "${id}"`);
  return found;
};

/** The first eight hex characters, which is what a generated header quotes. */
export const short = (sha256: string): string => sha256.slice(0, 8);

/**
 * The cached document's bytes, refused unless they hash to what the manifest recorded.
 *
 * ⚠️ THE ERROR NAMES THE FETCH COMMAND. A stale or missing cache is the normal case on a machine
 *   that has never run this, and an operator should not have to read the generator to fix it.
 */
export const readCached = async (e: ManifestEntry): Promise<string> => {
  const path = join(cacheDir(), e.cacheFile);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `${e.id}: ${path} is missing. Fetch it read-only:\n  ${e.fetch}\n` +
        `(cache root: $HF_SCHEMA_CACHE, default ~/.cache/homeflare/schemas)`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== e.sha256) {
    throw new Error(
      `${e.id}: ${path} is sha256 ${short(sha)}…, manifest says ${short(e.sha256)}… ` +
        `(${e.version}). Either the host moved on — refresh the manifest entry and rerun ` +
        `\`bun run api:coverage\` — or this is a different document. Never edit the generated ` +
        `output to match.`,
    );
  }
  return new TextDecoder().decode(bytes);
};

/** One node of a Proxmox `apidoc.js` tree. Only the fields this pipeline reads are named. */
export type ApiNode = {
  readonly path?: string;
  readonly info?: Record<string, ApiMethod>;
  readonly children?: readonly ApiNode[];
};

export type ApiMethod = {
  readonly method?: string;
  readonly parameters?: unknown;
};

/**
 * Both products ship their schema as ONE JavaScript assignment followed by viewer code.
 *
 * ⚠️ PVE OPENS `const apiSchema = [` AND PBS OPENS `var apiSchema = [`, and their terminators
 *   differ too: PVE closes with `]` on its own line and a bare `;` on the NEXT one, PBS with `];`.
 *   Slicing on `\n];` finds nothing in PVE and the parse dies at EOF. Measured on
 *   pve-manager/9.2.4 and proxmox-backup-server 4.2.6-1, 2026-09-22.
 */
export const parseApidoc = (raw: string): readonly ApiNode[] => {
  const lines = raw.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && (l === ']' || l === '];'));
  if (end < 0) throw new Error('apidoc.js: no line is exactly "]" or "];" — the format changed');
  const body = lines
    .slice(0, end + 1)
    .join('\n')
    .replace(/^(?:const|var)\s+apiSchema\s*=\s*/, '')
    .replace(/;$/, '');
  return JSON.parse(body) as readonly ApiNode[];
};

export type Endpoint = {
  readonly path: string;
  readonly method: string;
  /** Parameter names carrying a vendor rule NOTHING WE GENERATE ENFORCES. Sorted, so output is stable. */
  readonly unenforced: readonly string[];
  /** Every parameter name the endpoint accepts. */
  readonly parameters: number;
};

/**
 * ⛔ `enum` IS DELIBERATELY ABSENT FROM THIS LIST. Measured 2026-09-22: of everything the vendor
 *   schema carries, the generated types in `packages/alchemy/src/proxmox/generated/` keep exactly
 *   `type`, `enum` (as a string-literal union) and `optional` (as `?`). An `enum` is therefore
 *   already enforced at compile time, and counting it would inflate the gap with the one
 *   constraint that does not leak.
 */
const UNENFORCED = ['maxLength', 'minLength', 'minimum', 'maximum', 'pattern', 'format'] as const;

/**
 * Does this parameter carry a rule a caller can violate and nothing local will catch?
 *
 * ⚠️ PBS's `format` IS AN OBJECT — a whole sub-schema for the inside of a property-string — while
 *   PVE's is a named string like `pve-node`. Both count; walking INTO the PBS one is a second
 *   layer this summary deliberately does not flatten, because a nested rule belongs to the nested
 *   field, not to the parameter that contains it.
 */
const isUnenforced = (value: unknown, enforced: ReadonlySet<string>): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  /**
   * ⛔ AN ARRAY STATES ITS RULES ON `items`, so a parameter with none of its own may still carry
   *   one. Both artefacts have to agree on what a rule IS, or the gap list and the guard describe
   *   different APIs — see codegen/param-rules.ts, which merges the same way.
   */
  const inner =
    p['type'] === 'array' && typeof p['items'] === 'object' && p['items'] !== null
      ? (p['items'] as Record<string, unknown>)
      : {};
  return UNENFORCED.some((k) => (p[k] ?? inner[k]) !== undefined && !enforced.has(k));
};

/**
 * Every endpoint in the tree, flattened, with the parameters nothing local enforces.
 *
 * ⛔ `product` IS NOT DECORATION. It is how a row is looked up in the generated constraint tables,
 *   which are keyed `pve:`/`pbs:` because both products publish `PUT /access/acl` with different
 *   rules. Without it this report counts rules the repository already checks.
 */
export const endpoints = (roots: readonly ApiNode[], product: string): readonly Endpoint[] => {
  const out: Endpoint[] = [];
  const walk = (n: ApiNode): void => {
    if (n.path !== undefined && n.info !== undefined) {
      for (const [method, spec] of Object.entries(n.info)) {
        /**
         * ⛔ NOT `parameters.properties`. PVE wraps a discriminated union in `allOf`/`oneOf`, and
         *   asking for `properties` there answers `undefined` — so `/cluster/ha/rules` was
         *   reported as having ZERO parameters and zero gaps while carrying a `maxLength` of
         *   4096. The constraint generator had the identical blind spot; both now read the
         *   combinators through the one resolver.
         * ⚠️ TWO PARSERS FOR ONE FILE FORMAT is the deeper defect — `codegen/apidoc.ts` and this
         *   file each slice `apidoc.js` themselves. Sharing the resolver closes the bug; merging
         *   the two readers is its own change.
         */
        const props = resolveParameters(spec.parameters).params as Record<string, unknown>;
        out.push({
          unenforced: Object.entries(props)
            .filter(([k, v]) =>
              isUnenforced(v, enforcedKinds(product, method, n.path as string, k)),
            )
            .map(([k]) => k)
            .sort(),
          method,
          parameters: Object.keys(props).length,
          path: n.path,
        });
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
};

/** POST / PUT / DELETE only: the calls that can change a cluster. */
export const isWrite = (e: Endpoint): boolean => e.method !== 'GET';
