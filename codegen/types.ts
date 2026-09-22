#!/usr/bin/env bun
/**
 * Regenerate the Proxmox API type files. `bun codegen/types.ts` — `--check` compares without
 * writing, which is what `tests/schema-types.test.ts` runs when the schema cache is present.
 *
 * ⛔ THIS IS THE GENERATOR THE COMMITTED TYPES CLAIMED TO HAVE. `generated/{pve,pbs}.ts` carried
 *   `Run: bun codegen/generate.ts` from the day they landed, and
 *   `git log --oneline --all -- 'codegen/generate*'` was empty: the mapping existed only as its
 *   own output, so nobody could reproduce it, correct it, or tell what version it described.
 *
 * ★ THE OLD OUTPUT IS REPRODUCED BEFORE IT IS CHANGED, and that is what makes the change
 *   reviewable. Run against the same two schemas with integers left widened, this pipeline emits
 *   all 646 PVE and 69 PBS declarations identically — see tests/schema-types.test.ts, which holds
 *   the mapping to the committed shapes rather than to a snapshot of itself.
 *
 * ⛔ NEVER HAND-EDIT THE OUTPUT. The staleness test recomputes the digest and names this command.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseApidoc } from './apidoc.ts';
import { REPO_ROOT, readManifest, verifiedText } from './schema-cache.ts';
import { NUMERIC_STRING, type VendorNode, paramType } from './tsmap.ts';
import { type Block, type Endpoint, blockFor, endpoints } from './types-endpoint.ts';
import { type Census, renderBarrel, renderModule } from './types-render.ts';
import { CAP, split } from './types-split.ts';

const OUT_DIR = join(REPO_ROOT, 'packages/alchemy/src/proxmox/generated');
const PRODUCTS = [
  { id: 'pve-apidoc', product: 'pve' },
  { id: 'pbs-apidoc', product: 'pbs' },
] as const;

/** The header costs lines too, so the body budget is the cap minus what the header spends. */
const HEADER_LINES = 18;

/** How many request parameters the vendor calls integer or number — the widening this undid. */
const numericParams = (all: readonly Endpoint[]): number => {
  let count = 0;
  for (const endpoint of all) {
    const properties = endpoint.info.parameters?.properties;
    if (properties === null || properties === undefined) continue;
    for (const property of Object.values<VendorNode>(properties)) {
      const type = paramType(property);
      if (type.kind === 'atom' && type.text === NUMERIC_STRING) count++;
    }
  }
  return count;
};

/**
 * Every exported name in one product, checked for the two ways a path can produce a bad identifier.
 *
 * ⛔ THE BARREL IS `export *`, SO A COLLISION IS A COMPILER ERROR IN A FILE NOBODY EDITED. Type
 *   names drop `{}` and split on `-`, so `/a/b-c` and `/a/b/c` would both become `ABC` — and the
 *   failure a vendor upgrade would hand the next person is `tsc` complaining about a generated
 *   barrel rather than a generator saying which two paths clashed. None collide on pve-manager
 *   9.2.11 or proxmox-backup-server 4.2.6-1; this is here for the upgrade that changes that.
 * ⛔ A SEGMENT STARTING WITH A DIGIT WOULD NOT BE AN IDENTIFIER AT ALL. Neither product has one
 *   today, and `export type 2FaGetReturn` is a parse error rather than a wrong type — still worth
 *   catching where the path that caused it can be named.
 */
const checkNames = (product: string, blocks: readonly Block[]): void => {
  const seen = new Map<string, string>();
  for (const block of blocks) {
    for (const name of block.names) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(
          `${product}: '${block.key}' produces '${name}', which is not a TypeScript identifier. ` +
            'Teach codegen/tsname.ts how to spell this path segment.',
        );
      }
      const owner = seen.get(name);
      if (owner !== undefined && owner !== block.key) {
        throw new Error(
          `${product}: '${block.key}' and '${owner}' both produce the type '${name}'. Two vendor ` +
            'paths now collapse to one name — codegen/tsname.ts has to distinguish them.',
        );
      }
      seen.set(name, block.key);
    }
  }
};

/** A digest of the generated TEXT, so a hand-edit anywhere in the tree fails the staleness test. */
export const digestOf = (files: ReadonlyMap<string, string>): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const path of [...files.keys()].sort()) hasher.update(`${path}\n${files.get(path) ?? ''}`);
  return hasher.digest('hex').slice(0, 16);
};

/** Every file this generator owns, as `<repo-relative path>` -> text. Pure once the schemas load. */
export const generate = async (): Promise<{
  readonly files: ReadonlyMap<string, string>;
  readonly census: Readonly<Record<string, Census>>;
  readonly irreducible: readonly string[];
}> => {
  const manifest = await readManifest();
  const files = new Map<string, string>();
  const census: Record<string, Census> = {};
  const irreducible: string[] = [];

  for (const { id, product } of PRODUCTS) {
    const entry = manifest.schemas.find((schema) => schema.id === id);
    if (entry === undefined) throw new Error(`codegen/manifest.json has no '${id}' entry`);
    const all = endpoints(parseApidoc(await verifiedText(manifest, id)));
    const blocks = all.map(blockFor);
    checkNames(product, blocks);
    const modules = split(blocks, CAP - HEADER_LINES);
    for (const module of modules) {
      const text = renderModule(entry, product, module, CAP);
      files.set(`packages/alchemy/src/proxmox/generated/${product}/${module.name}.ts`, text);
      if (module.irreducible) irreducible.push(`${product}/${module.name}.ts`);
    }
    const counts: Census = {
      declarations: blocks.reduce((total, block) => total + block.names.length, 0),
      endpoints: all.length,
      numeric: numericParams(all),
    };
    census[product] = counts;
    files.set(
      `packages/alchemy/src/proxmox/generated/${product}.ts`,
      renderBarrel(entry, product, modules, counts),
    );
  }
  return { census, files, irreducible };
};

/**
 * ⚠️ THE PRODUCT DIRECTORIES ARE EMPTIED BEFORE WRITING. A vendor upgrade that removes an API area
 *   would otherwise leave its file behind, still exported by a barrel that no longer mentions it —
 *   a type describing an endpoint the cluster does not have, which is the failure this whole
 *   pipeline exists to prevent.
 */
const writeAll = async (files: ReadonlyMap<string, string>): Promise<void> => {
  for (const { product } of PRODUCTS) {
    rmSync(join(OUT_DIR, product), { force: true, recursive: true });
  }
  for (const [path, text] of files) await Bun.write(join(REPO_ROOT, path), text);
};

/** Files under the product directories that this run did not produce — a stale leftover. */
const orphans = (files: ReadonlyMap<string, string>): readonly string[] => {
  const out: string[] = [];
  for (const { product } of PRODUCTS) {
    const dir = join(OUT_DIR, product);
    let names: readonly string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = `packages/alchemy/src/proxmox/generated/${product}/${name}`;
      if (!files.has(path)) out.push(path);
    }
  }
  return out;
};

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const { census, files, irreducible } = await generate();
  const summary = PRODUCTS.map(({ product }) => {
    const counts = census[product] as Census;
    return `${product} ${String(counts.endpoints)} endpoints / ${String(counts.declarations)} types`;
  }).join(', ');

  if (!check) {
    await writeAll(files);
    console.log(`wrote ${String(files.size)} files — ${summary}, digest ${digestOf(files)}`);
    if (irreducible.length > 0)
      console.log(`over the ${String(CAP)}-line cap: ${irreducible.join(', ')}`);
    return;
  }

  const stale: string[] = [];
  for (const [path, text] of files) {
    const file = Bun.file(join(REPO_ROOT, path));
    const current = (await file.exists()) ? await file.text() : '';
    if (current !== text) stale.push(path);
  }
  const left = orphans(files);
  console.log(`${summary} — ${stale.length === 0 && left.length === 0 ? 'current' : 'STALE'}`);
  if (stale.length > 0 || left.length > 0) {
    for (const path of [...stale, ...left.map((path) => `${path} (no longer generated)`)]) {
      console.error(`  ${path}`);
    }
    console.error('Refresh with: bun codegen/types.ts');
    process.exit(1);
  }
};

if (import.meta.main) await main();
