#!/usr/bin/env bun
/**
 * Regenerate the Paperless constraint tables, generated TypeScript types and coverage report.
 * `bun codegen/paperless.ts` — `--check` to compare without writing, which is what
 * `tests/paperless-manifest.test.ts` runs when the cache is present, and skips with the exact
 * fetch command otherwise.
 *
 * ★ SAME SHAPE AS `codegen/netbox.ts`, PLUS A SECOND OUTPUT. NetBox only needed constraint
 *   tables because `Netbox.Prefix`'s Props/Attributes are hand-typed. This family's props ARE
 *   generated (`generated/types/*.ts`, via `openapi-types.ts`), because the doctrine this unit
 *   was cut under is "generate types/props from the vendor's own schema, never hand-typed."
 * ⛔ THE RAW DOCUMENT IS NOT IN GIT — see codegen/README.md. A mismatched sha256 STOPS the
 *   generator rather than building from whatever the cache happens to hold.
 */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { formatAs } from '../scripts/api-coverage-format.ts';
import { type EmittedParam, emitEndpoint } from './emit.ts';
import { type FamilyKey, emitFamilyModule } from './openapi-types.ts';
import { openApiEndpoints, openApiKeyOf, parseOpenApi } from './openapi.ts';
import { renderCoverage } from './paperless-coverage.ts';
import {
  CAP,
  type PaperlessManifestEntry,
  areaOf,
  constName,
  digest,
  render,
  renderIndex,
} from './paperless-render.ts';

const ROOT = join(import.meta.dir, '..');
const SOURCE_DIR = join(ROOT, 'packages/alchemy/src/paperless');
const CONSTRAINTS_DIR = join(SOURCE_DIR, 'generated/constraints');
const TYPES_DIR = join(SOURCE_DIR, 'generated/types');
const DOC = join(ROOT, 'docs/paperless-coverage.md');
const PREFIX = 'paperless:';

/** ★ One family per taxonomy Resource — the whole of this unit's write surface. */
const FAMILIES: readonly FamilyKey[] = [
  { area: 'tags', createKey: 'paperless:POST /api/tags/', tsName: 'Tag' },
  {
    area: 'document_types',
    createKey: 'paperless:POST /api/document_types/',
    tsName: 'DocumentType',
  },
  { area: 'storage_paths', createKey: 'paperless:POST /api/storage_paths/', tsName: 'StoragePath' },
  { area: 'custom_fields', createKey: 'paperless:POST /api/custom_fields/', tsName: 'CustomField' },
];

interface Manifest {
  readonly cacheDir: string;
  readonly schemas: readonly (PaperlessManifestEntry & { readonly file: string; bytes: number })[];
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
      `${entry.id}: ${path} is missing. Fetch it — \`curl -fsS ` +
        `'http://127.0.0.1:28981/api/schema/?format=json' > ${path}\` — or set ` +
        'HOMEFLARE_SCHEMA_CACHE to the directory that holds it.',
    );
  }
  const bytes = await file.arrayBuffer();
  const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (sha !== entry.sha256 || bytes.byteLength !== entry.bytes) {
    throw new Error(
      `${entry.id}: ${path} is sha256 ${sha.slice(0, 16)} / ${bytes.byteLength} bytes, the ` +
        `manifest says ${entry.sha256.slice(0, 16)} / ${entry.bytes}.`,
    );
  }
  return new TextDecoder().decode(bytes);
};

/** Endpoint keys this package's own source names — providers only, never a test. */
const keysFromSource = async (): Promise<ReadonlyMap<string, string>> => {
  const found = new Map<string, string>();
  const pattern = /'(paperless:(?:POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/{}._-]*)'/g;
  for (const name of readdirSync(SOURCE_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = await Bun.file(join(SOURCE_DIR, name)).text();
    for (const match of text.matchAll(pattern))
      found.set(match[1] as string, `packages/alchemy/src/paperless/${name}`);
  }
  return found;
};

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const entry = manifest.schemas.find((s) => s.id === 'paperless-openapi');
  if (entry === undefined) throw new Error('manifest has no paperless-openapi entry');

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
        `${key} is named in packages/alchemy/src/paperless but ${entry.product} ${entry.version} ` +
          'has no such endpoint. Fix the key, or the manifest is stale.',
      );
    }
    const table = emitEndpoint(endpoint, 'paperless');
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
        `paperless-${area}.ts would be ${lines} lines, over the house cap of ${CAP}.`,
      );
    }
    modules.push({ constant: constName(area), file: `paperless-${area}.ts`, text });
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

  const areaCounts = new Map<string, number>();
  for (const key of endpoints.keys()) {
    const area = (key.split(' ')[1] ?? '/').split('/')[2] ?? 'root';
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }
  const coverage = await formatAs(
    ROOT,
    renderCoverage({
      areas: [...areaCounts]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([area, n]) => ({ area, endpoints: n })),
      digest: overall,
      entry,
      rows,
      writeEndpoints: endpoints.size,
      writePaths: writePaths.size,
    }),
    'paperless-coverage.md',
  );

  const types = FAMILIES.map((family) =>
    emitFamilyModule(
      doc,
      entry,
      family,
      `${wanted.size} of ${entry.product}'s ${endpoints.size} write endpoints are used by this ` +
        `family; this file covers only /api/${family.area}/.`,
    ),
  );
  const typesIndex =
    `/**\n * Every generated Paperless taxonomy type, re-exported — DO NOT EDIT BY HAND.\n *\n` +
    ` * Run: bun codegen/paperless.ts\n */\n${types
      .map((t) => `export * from './${t.file.replace(/\.ts$/, '.ts')}';`)
      .join('\n')}\n`;

  const targets = [
    ...modules.map((m) => ({ next: m.text, path: join(CONSTRAINTS_DIR, m.file) })),
    ...types.map((t) => ({ next: t.text, path: join(TYPES_DIR, t.file) })),
    { next: typesIndex, path: join(TYPES_DIR, 'index.ts') },
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
      console.error('Refresh with: bun codegen/paperless.ts');
      process.exit(1);
    }
    return;
  }
  console.log(
    `wrote ${wanted.size} endpoints and ${types.length} type modules across ${targets.length} files, digest ${overall}`,
  );
};

await main();
