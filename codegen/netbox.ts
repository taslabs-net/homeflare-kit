#!/usr/bin/env bun
/**
 * Regenerate the NetBox constraint tables and coverage report. `bun codegen/netbox.ts` —
 * `--check` to compare without writing, which is what `tests/netbox-manifest.test.ts` runs when
 * the cache is present.
 *
 * ⛔ PROVENANCE IS THE PRODUCT HERE, NOT A COURTESY. Every table names its manifest entry, the
 *   product version and the sha256 of the bytes that were read, so a reader can tell WHAT IT IS
 *   TRUE OF. A constraint with no source is a guess, and a guess here would be enforced at plan
 *   time against a declaration NetBox would have accepted.
 * ⛔ THE RAW DOCUMENT IS NOT IN GIT. It is 14 MB of vendor-authored JSON, reproducible from the
 *   manifest's sha256 in one command (codegen/README.md); only the generated, diffable tables are
 *   committed. A mismatched sha256 STOPS the generator rather than quietly building from whatever
 *   the cache happens to hold.
 */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * ⛔ THE COVERAGE REPORT GOES THROUGH THE REPOSITORY'S OWN FORMATTER BEFORE IT IS WRITTEN.
 *   `oxfmt` formats markdown too — it aligns table columns — so a generator that emitted its own
 *   spacing would leave `bun run lint` failing after every regeneration, on a diff that has
 *   nothing to do with the person's change. ★ The generated TypeScript needs no such pass: the
 *   `generated` directories are in oxfmt's ignore list, which is what keeps the committed table
 *   at one parameter per line.
 */
import { formatAs } from '../scripts/api-coverage-format.ts';
import { type EmittedParam, emitEndpoint } from './emit.ts';
import { renderCoverage } from './netbox-coverage.ts';
import {
  CAP,
  type NetboxManifestEntry,
  areaOf,
  constName,
  digest,
  render,
  renderIndex,
} from './netbox-render.ts';
import { openApiEndpoints, openApiKeyOf, parseOpenApi } from './openapi.ts';

const ROOT = join(import.meta.dir, '..');
const SOURCE_DIR = join(ROOT, 'packages/alchemy/src/netbox');
const OUT_DIR = join(SOURCE_DIR, 'generated/constraints');
const DOC = join(ROOT, 'docs/netbox-coverage.md');
const PREFIX = 'netbox:';

interface Manifest {
  readonly cacheDir: string;
  readonly schemas: readonly (NetboxManifestEntry & { readonly file: string; bytes: number })[];
}

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as Manifest;

const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);

/** ⛔ The sha256 IS the identity. A near-miss is a different API, not a rounding error. */
const verified = async (entry: Manifest['schemas'][number]): Promise<string> => {
  const path = join(cacheDir, entry.file);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `${entry.id}: ${path} is missing. Re-fetch it — see codegen/README.md — or set ` +
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

/**
 * Which endpoints to table: the ones this package's own source names, and where.
 *
 * ★ THE FILE THAT NAMES A KEY IS ALSO THE COVERAGE REPORT'S OWNER COLUMN. One scan, two outputs —
 *   so the report cannot disagree with the tables the way a hand-kept ledger can.
 * ⛔ PROVIDERS ONLY. A test names endpoints that deliberately do not exist, and scanning them
 *   would stop the generator dead.
 */
const keysFromSource = async (): Promise<ReadonlyMap<string, string>> => {
  const found = new Map<string, string>();
  const pattern = /'(netbox:(?:POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/{}._-]*)'/g;
  for (const name of readdirSync(SOURCE_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = await Bun.file(join(SOURCE_DIR, name)).text();
    for (const match of text.matchAll(pattern)) {
      found.set(match[1] as string, `packages/alchemy/src/netbox/${name}`);
    }
  }
  return found;
};

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const entry = manifest.schemas.find((s) => s.id === 'netbox-openapi');
  if (entry === undefined) throw new Error('manifest has no netbox-openapi entry');

  const doc = parseOpenApi(await verified(entry));
  const endpoints = new Map(openApiEndpoints(doc).map((e) => [openApiKeyOf(e), e]));
  const writePaths = new Set([...endpoints.keys()].map((k) => k.split(' ')[1] ?? ''));

  const wanted = await keysFromSource();
  const byArea = new Map<string, Record<string, Readonly<Record<string, EmittedParam>>>>();
  const merged: Record<string, Readonly<Record<string, EmittedParam>>> = {};
  const rows: {
    key: string;
    source: string;
    params: number;
    enforced: number;
    recordedOnly: number;
  }[] = [];

  for (const key of [...wanted.keys()].sort()) {
    const endpoint = endpoints.get(key.slice(PREFIX.length));
    if (endpoint === undefined) {
      throw new Error(
        `${key} is named in packages/alchemy/src/netbox but ${entry.product} ${entry.version} ` +
          'has no such endpoint. Fix the key, or the manifest is stale.',
      );
    }
    const table = emitEndpoint(endpoint, 'netbox');
    const area = areaOf(key);
    byArea.set(area, { ...byArea.get(area), [key]: table });
    merged[key] = table;
    const values = Object.values(table);
    rows.push({
      enforced: values.filter((r) => r.patternSource === undefined || r.pattern !== undefined)
        .length,
      key,
      params: values.length,
      recordedOnly: values.filter((r) => r.patternSource !== undefined && r.pattern === undefined)
        .length,
      source: wanted.get(key) as string,
    });
  }

  const modules: { file: string; constant: string; text: string }[] = [];
  for (const [area, tables] of [...byArea].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const text = render(entry, area, tables, wanted.size, endpoints.size);
    const lines = text.split('\n').length;
    if (lines > CAP) {
      throw new Error(
        `netbox-${area}.ts would be ${lines} lines, over the house cap of ${CAP}. Split this ` +
          'area by its third path segment rather than letting one file grow.',
      );
    }
    modules.push({ constant: constName(area), file: `netbox-${area}.ts`, text });
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

  const apps = new Map<string, number>();
  for (const key of endpoints.keys()) {
    const app = (key.split(' ')[1] ?? '/').split('/')[2] ?? 'root';
    apps.set(app, (apps.get(app) ?? 0) + 1);
  }
  const coverage = await formatAs(
    ROOT,
    renderCoverage({
      apps: [...apps]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([app, n]) => ({ app, endpoints: n })),
      digest: overall,
      entry,
      rows,
      writeEndpoints: endpoints.size,
      writePaths: writePaths.size,
    }),
    'netbox-coverage.md',
  );

  const targets = [
    ...modules.map((m) => ({ next: m.text, path: join(OUT_DIR, m.file) })),
    { next: coverage, path: DOC },
  ];

  let stale = 0;
  for (const target of targets) {
    const current = (await Bun.file(target.path).exists())
      ? await Bun.file(target.path).text()
      : '';
    if (check) {
      if (current !== target.next) stale++;
      continue;
    }
    await Bun.write(target.path, target.next);
  }

  if (check) {
    console.log(
      `${wanted.size} endpoints, ${targets.length} files — ${stale === 0 ? 'current' : `${stale} STALE`}`,
    );
    if (stale > 0) {
      console.error('Refresh with: bun codegen/netbox.ts');
      process.exit(1);
    }
    return;
  }
  console.log(`wrote ${wanted.size} endpoints across ${targets.length} files, digest ${overall}`);
};

await main();
