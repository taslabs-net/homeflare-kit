#!/usr/bin/env bun
/**
 * Regenerate the vendor constraint tables. `bun codegen/constraints.ts` — `--check` to compare
 * without writing, which is what `tests/schema-manifest.test.ts` runs when the cache is present.
 *
 * ⛔ PROVENANCE IS THE PRODUCT HERE, NOT A COURTESY. Every table says which manifest entry it came
 *   from, at which product version and which sha256, so a reader can tell WHAT IT IS TRUE OF. A
 *   constraint with no source is a guess, and a guess in this file would be enforced at plan time
 *   against a declaration the vendor would have accepted.
 * ⛔ THE RAW SCHEMAS ARE NOT IN GIT. 5.8 MB of vendor-authored JavaScript, reproducible from the
 *   manifest's sha256 by re-fetching (codegen/README.md); only the generated, diffable table is
 *   committed. A mismatched sha256 STOPS the generator rather than quietly building from whatever
 *   the cache happens to hold.
 */
import { readdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type VendorEndpoint, endpointsOf, keyOf, parseApidoc } from './apidoc.ts';
import { type EmittedParam, digest, emitEndpoint } from './emit.ts';
import { CAP, type ManifestEntry, areaOf, constName, render, renderIndex } from './render.ts';

const ROOT = join(import.meta.dir, '..');
const SOURCE_DIR = join(ROOT, 'packages/alchemy/src/proxmox');
const OUT_DIR = join(SOURCE_DIR, 'generated/constraints');
const PRODUCTS = ['pve', 'pbs'] as const;

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as {
  cacheDir: string;
  schemas: readonly ManifestEntry[];
};

const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);

/** ⛔ The sha256 IS the identity. A near-miss is a different API, not a rounding error. */
const verified = async (entry: ManifestEntry): Promise<string> => {
  const path = join(cacheDir, entry.file);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `${entry.id}: ${path} is missing. Re-fetch it read-only — see codegen/README.md — ` +
        'or set HOMEFLARE_SCHEMA_CACHE to the directory that holds it.',
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

/**
 * Which endpoints to table: the ones this package's own source names.
 *
 * ★ NOT EVERY WRITE ENDPOINT THE VENDOR HAS, AND THE REASON IS THE HOUSE RULE ABOUT GUESSING. A
 *   table for an endpoint no Resource writes enforces nothing and is 2,600 lines of data nobody
 *   reviews. The keys come from the source, so adding a family adds its table on the next run —
 *   and a key that names an endpoint the vendor does not have STOPS this generator, which is how a
 *   typo is caught before it becomes a runtime "no table for ..." on somebody's deploy.
 */
const keysFromSource = async (): Promise<ReadonlySet<string>> => {
  const found = new Set<string>();
  const pattern = /'((?:pve|pbs):(?:POST|PUT) \/[A-Za-z0-9/{}._-]*)'/g;
  for (const name of readdirSync(SOURCE_DIR)) {
    // ⛔ PROVIDERS ONLY. A test names endpoints that deliberately do not exist (constraints.test.ts
    //   asserts the "no table for ..." defect), and scanning them would stop the generator dead.
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = await Bun.file(join(SOURCE_DIR, name)).text();
    for (const match of text.matchAll(pattern)) found.add(match[1] as string);
  }
  return found;
};

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const wanted = await keysFromSource();
  const modules: { file: string; constant: string; text: string }[] = [];
  const merged: Record<string, Readonly<Record<string, EmittedParam>>> = {};

  for (const product of PRODUCTS) {
    const entry = manifest.schemas.find((s) => s.id === `${product}-apidoc`);
    if (entry === undefined) throw new Error(`manifest has no ${product}-apidoc entry`);
    const endpoints = new Map<string, VendorEndpoint>();
    for (const endpoint of endpointsOf(parseApidoc(await verified(entry)))) {
      endpoints.set(keyOf(endpoint), endpoint);
    }
    const total = [...endpoints.keys()].filter(
      (k) => k.startsWith('POST ') || k.startsWith('PUT '),
    ).length;

    const byArea = new Map<string, Record<string, Readonly<Record<string, EmittedParam>>>>();
    const keys = [...wanted].filter((k) => k.startsWith(`${product}:`)).sort();
    for (const key of keys) {
      const endpoint = endpoints.get(key.slice(product.length + 1));
      if (endpoint === undefined) {
        throw new Error(
          `${key} is named in packages/alchemy/src/proxmox but ${entry.product} ` +
            `${entry.version} has no such endpoint. Fix the key, or the manifest is stale.`,
        );
      }
      const area = areaOf(key);
      const table = byArea.get(area) ?? {};
      table[key] = emitEndpoint(endpoint);
      merged[key] = table[key] as Readonly<Record<string, EmittedParam>>;
      byArea.set(area, table);
    }

    for (const [area, tables] of [...byArea].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const text = render(entry, product, area, tables, keys.length, total);
      const lines = text.split('\n').length;
      if (lines > CAP) {
        throw new Error(
          `${product}-${area}.ts would be ${lines} lines, over the house cap of ${CAP}. Split ` +
            'this area by its second path segment rather than letting one file grow.',
        );
      }
      modules.push({ constant: constName(product, area), file: `${product}-${area}.ts`, text });
    }
  }

  const overall = digest(merged);
  modules.push({
    constant: '',
    file: 'index.ts',
    text: renderIndex(
      modules.map((m) => ({ constant: m.constant, file: m.file })),
      overall,
    ),
  });

  /**
   * ⛔ A GENERATED FILE THE GENERATOR NO LONGER PRODUCES IS DELETED, NOT LEFT LYING. Changing how
   *   areas are split renames files, and a leftover table is imported by nothing while reading
   *   exactly like a table that is consulted — the same trap the generated index exists to avoid.
   *   In `--check` it counts as stale, so CI says so rather than a reviewer noticing.
   */
  const produced = new Set(modules.map((module) => module.file));
  const orphans = readdirSync(OUT_DIR).filter(
    (name) => name.endsWith('.ts') && !produced.has(name),
  );

  let stale = orphans.length;
  for (const module of modules) {
    const path = join(OUT_DIR, module.file);
    const current = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
    if (check) {
      if (current !== module.text) stale++;
      continue;
    }
    await Bun.write(path, module.text);
  }
  if (!check) for (const name of orphans) await unlink(join(OUT_DIR, name));
  const count = Object.keys(merged).length;
  if (check) {
    console.log(
      `${count} endpoints, ${modules.length} files — ${stale === 0 ? 'current' : `${stale} STALE`}`,
    );
    if (stale > 0) {
      if (orphans.length > 0) console.error(`orphaned: ${orphans.join(', ')}`);
      console.error('Refresh with: bun codegen/constraints.ts');
      process.exit(1);
    }
    return;
  }
  console.log(`wrote ${count} endpoints across ${modules.length} files, digest ${overall}`);
};

await main();
