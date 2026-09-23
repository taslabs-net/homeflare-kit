#!/usr/bin/env bun
/**
 * Regenerate `packages/alchemy/src/litellm/generated/pass-through.ts` from LiteLLM's own OpenAPI
 * document. `bun codegen/litellm.ts` — `--check` compares without writing, the mode
 * `tests/litellm-manifest.test.ts` runs when the schema cache holds the `litellm-openapi` entry.
 *
 * ★ THE SELECTION IS CONSUMER-DRIVEN, NOT "EVERY LITELLM ENDPOINT". Unlike `codegen/types.ts`
 *   (every PVE/PBS endpoint, on purpose — see TYPES.md), LiteLLM's proxy has 696 paths and this
 *   package writes to four of them. `keysFromSource` reads the `litellm:<METHOD> <path>` string
 *   literals the client actually declares, the same way `codegen/constraints.ts` reads
 *   `'pve:POST ...'` keys — so a key naming an endpoint the vendor does not have STOPS this
 *   generator, rather than failing on somebody's deploy as a runtime 404.
 * ⛔ NEVER HAND-EDIT THE OUTPUT. `tests/litellm-manifest.test.ts` recomputes its digest.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type JsonSchema,
  type OpenApiDoc,
  renderInterface,
  requireOperation,
} from './litellm-emit.ts';
import { REPO_ROOT, entryFor, readManifest, verifiedText } from './schema-cache.ts';

const SOURCE_DIR = join(REPO_ROOT, 'packages/alchemy/src/litellm');
const OUT_PATH = join(SOURCE_DIR, 'generated/pass-through.ts');
const MANIFEST_ID = 'litellm-openapi';

/** The `litellm:<METHOD> <path>` keys the client declares — see codegen/litellm.ts header. */
const keysFromSource = (): ReadonlySet<string> => {
  const found = new Set<string>();
  const pattern = /'(litellm:(?:GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/{}._-]*)'/g;
  for (const name of readdirSync(SOURCE_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const text = readFileSync(join(SOURCE_DIR, name), 'utf8');
    for (const m of text.matchAll(pattern)) found.add(m[1] as string);
  }
  return found;
};

/** `$ref` names a schema references at its own top level, or one array level down. */
const rootRefsOf = (schema: JsonSchema | undefined): readonly string[] => {
  if (schema === undefined) return [];
  if (schema.$ref !== undefined) return [schema.$ref.replace('#/components/schemas/', '')];
  if (schema.type === 'array' && schema.items?.$ref !== undefined) {
    return [schema.items.$ref.replace('#/components/schemas/', '')];
  }
  return [];
};

interface Op {
  readonly requestBody?: { readonly content?: Record<string, { readonly schema?: JsonSchema }> };
  readonly responses?: Record<
    string,
    { readonly content?: Record<string, { readonly schema?: JsonSchema }> }
  >;
}

const generate = async (): Promise<{ readonly text: string; readonly coverage: string }> => {
  const manifest = await readManifest();
  const entry = entryFor(manifest, MANIFEST_ID);
  const doc = JSON.parse(await verifiedText(manifest, MANIFEST_ID)) as OpenApiDoc;

  const keys = [...keysFromSource()].sort();
  if (keys.length === 0)
    throw new Error(`litellm.ts: no 'litellm:<METHOD> <path>' keys found in ${SOURCE_DIR}`);

  const wanted = new Set<string>();
  for (const key of keys) {
    const [method, path] = key.replace('litellm:', '').split(' ') as [string, string];
    const op = requireOperation(doc, method, path) as Op;
    for (const ref of rootRefsOf(op.requestBody?.content?.['application/json']?.schema))
      wanted.add(ref);
    for (const ref of rootRefsOf(op.responses?.['200']?.content?.['application/json']?.schema)) {
      wanted.add(ref);
    }
  }

  // ★ A referenced schema can itself reference another (PassThroughGenericEndpoint.guardrails ->
  //   PassThroughGuardrailSettings) — renderInterface adds those to `wanted` as it renders, so this
  //   loop drains a queue rather than iterating a fixed set.
  const rendered = new Map<string, string>();
  const queue = [...wanted];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (rendered.has(name)) continue;
    const schema = doc.components.schemas[name];
    if (schema === undefined) throw new Error(`litellm.ts: no component schema named '${name}'`);
    const before = new Set(wanted);
    rendered.set(name, renderInterface(name, schema, wanted));
    for (const added of wanted) if (!before.has(added)) queue.push(added);
  }

  const names = [...rendered.keys()].sort();
  const shaPrefix = entry.sha256.slice(0, 16);
  const header = [
    '/**',
    " * Generated from LiteLLM 1.100.0's OpenAPI document -- DO NOT EDIT BY HAND.",
    ' *',
    ' * Run: bun codegen/litellm.ts    (`--check` compares without writing)',
    ` * Manifest entry: \`${MANIFEST_ID}\` -- ${entry.product} ${entry.version}`,
    ` *   sha256 ${shaPrefix}..., read from codegen/manifest.json's own note on how this document`,
    " *   was produced (the vendor's own generator, cross-checked byte-identically — not a live read).",
    ` *`,
    ` * Covers the ${String(keys.length)} pass-through operations this package writes to:`,
    ...keys.map((k) => ` *   ${k}`),
    ' *',
    ' * Does NOT cover the other 692 paths LiteLLM 1.100.0 publishes — this generator is',
    ' * consumer-driven (codegen/litellm.ts), not exhaustive. See codegen/README.md.',
    ' */',
  ].join('\n');
  const text = `${header}\n\n${names.map((n) => rendered.get(n) as string).join('\n\n')}\n`;
  return { text, coverage: `${String(keys.length)} operations / ${String(names.length)} types` };
};

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const { text, coverage } = await generate();
  if (!check) {
    await Bun.write(OUT_PATH, text);
    console.log(`wrote packages/alchemy/src/litellm/generated/pass-through.ts — ${coverage}`);
    return;
  }
  const file = Bun.file(OUT_PATH);
  const current = (await file.exists()) ? await file.text() : '';
  if (current === text) {
    console.log(`litellm pass-through types — current (${coverage})`);
    return;
  }
  console.error('litellm pass-through types are STALE. Refresh with: bun codegen/litellm.ts');
  process.exit(1);
};

if (import.meta.main) await main();
