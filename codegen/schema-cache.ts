/**
 * Getting a vendor schema out of the cache, with its identity checked first.
 *
 * ⛔ THE sha256 IS THE IDENTITY. A near-miss is a different API, not a rounding error — and a
 *   generator that builds from "whatever the cache happens to hold" produces a file whose header
 *   names a version it was not read from, which is worse than no header at all.
 * ⛔ THE RAW SCHEMAS ARE NOT IN GIT (codegen/README.md). 5.8 MB of vendor-authored JavaScript,
 *   reproducible in one read-only `ssh … sudo -n cat`; only the generated, diffable output is
 *   committed. A CI runner therefore has no cache, which is why `present()` exists: the staleness
 *   tests SKIP with a message there rather than failing on a repository that is perfectly current.
 *
 * ⚠️ DELIBERATELY NOT IMPORTED BY codegen/constraints.ts. That generator carries its own copy of
 *   this logic and predates this file; folding them together is a worthwhile change and a separate
 *   one, because it would edit the generator that produces the tables in the same commit that adds
 *   the generator that produces the types.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ManifestSchema {
  readonly id: string;
  readonly vendor: string;
  readonly product: string;
  readonly version: string;
  readonly sourceRole: string;
  readonly sourcePath: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly consumedBy: readonly string[];
}

export interface Manifest {
  readonly cacheDir: string;
  readonly schemas: readonly ManifestSchema[];
}

export const REPO_ROOT = join(import.meta.dir, '..');

export const readManifest = async (): Promise<Manifest> =>
  (await Bun.file(join(REPO_ROOT, 'codegen/manifest.json')).json()) as Manifest;

export const entryFor = (manifest: Manifest, id: string): ManifestSchema => {
  const entry = manifest.schemas.find((schema) => schema.id === id);
  if (entry === undefined) throw new Error(`codegen/manifest.json has no '${id}' entry`);
  return entry;
};

/** `~/.cache/homeflare/schemas`, or wherever `HOMEFLARE_SCHEMA_CACHE` points. */
export const cacheDirOf = (manifest: Manifest): string =>
  (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(/^~/, homedir());

/** True when every named schema is in the cache — so a test can skip instead of failing on CI. */
export const present = async (manifest: Manifest, ids: readonly string[]): Promise<boolean> => {
  for (const id of ids) {
    const path = join(cacheDirOf(manifest), entryFor(manifest, id).file);
    if (!(await Bun.file(path).exists())) return false;
  }
  return true;
};

/** The schema's text, or a message that says exactly how to get the right bytes back. */
export const verifiedText = async (manifest: Manifest, id: string): Promise<string> => {
  const entry = entryFor(manifest, id);
  const path = join(cacheDirOf(manifest), entry.file);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `${entry.id}: ${path} is missing. Re-fetch it read-only — see codegen/README.md — or set ` +
        'HOMEFLARE_SCHEMA_CACHE to the directory that holds it.',
    );
  }
  const bytes = await file.arrayBuffer();
  const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (sha !== entry.sha256 || bytes.byteLength !== entry.bytes) {
    throw new Error(
      `${entry.id}: ${path} is sha256 ${sha.slice(0, 16)} / ${bytes.byteLength} bytes, the ` +
        `manifest says ${entry.sha256.slice(0, 16)} / ${entry.bytes}. Either the cache holds a ` +
        'different version, or the manifest entry needs updating WITH its version string.',
    );
  }
  return new TextDecoder().decode(bytes);
};
