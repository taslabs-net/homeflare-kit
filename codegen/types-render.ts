/**
 * The text of a generated type file, and of the barrel that keeps the old import path working.
 *
 * ⛔ PROVENANCE IS THE PRODUCT HERE, NOT A COURTESY. The files this replaces said
 *   `Run: bun codegen/generate.ts` and that file has existed at no commit, so the only honest
 *   answer to "what is this true of?" was "nobody knows". Every file below names its manifest
 *   entry, the version the host reported, and the sha256 of the bytes it was read from.
 */
import type { ManifestSchema } from './schema-cache.ts';
import type { Module } from './types-split.ts';

export interface Census {
  readonly endpoints: number;
  readonly declarations: number;
  /** Request parameters whose vendor type is integer or number. */
  readonly numeric: number;
}

const provenance = (entry: ManifestSchema): string =>
  ` * Manifest entry: \`${entry.id}\` — ${entry.product} ${entry.version}
 *   sha256 ${entry.sha256.slice(0, 16)}, read on a ${entry.sourceRole} from
 *   ${entry.sourcePath}`;

const overCap = (module: Module, cap: number, lines: number): string =>
  module.irreducible
    ? `
 *
 * ⛔ ${lines} LINES, OVER THE HOUSE CAP OF ${cap}, AND IT CANNOT BE SPLIT. This file holds ONE
 *   endpoint, and one type declaration is the smallest unit there is. The size is a vendor enum
 *   with hundreds of members (\`mp0\`…\`mp255\`, \`unused0\`…\`unused255\`); dropping it would widen the
 *   parameter back to \`string\`, which is the defect this generator exists to remove.
 *   codegen/types-split.ts carries the reasoning; tests/schema-types.test.ts pins the list.`
    : '';

/** One generated file: header, then the endpoints in the vendor's own order. */
export const renderModule = (
  entry: ManifestSchema,
  product: string,
  module: Module,
  cap: number,
): string => {
  const body = module.blocks.map((block) => block.text).join('\n');
  const lines = body.split('\n').length + 18;
  return `/**
 * Generated ${entry.product} API types for \`${module.name === 'root' ? '/' : `/${module.name.replaceAll('-', '/')}`}\` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (\`--check\` compares without writing)
${provenance(entry)}
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. \`client.ts\` sends form encoding, so an integer is
 *   \`\\\`\${number}\\\`\` and a boolean is \`'0' | '1'\` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   ${product}/../constraints (codegen/README.md). A response is JSON and is not spelled that way.${overCap(module, cap, lines)}
 */

${body}`;
};

/**
 * `generated/pve.ts` — the file every existing import already names.
 *
 * ⛔ A BARREL RATHER THAN A RENAME, SO NO CONSUMER MOVES. `pool.ts`, `notification-matcher-form.ts`
 *   and four tests import from `./generated/pve.ts`; turning that path into a directory would have
 *   made a mechanical import churn part of a diff that is already about what the types MEAN.
 * ⚠️ `export *` IS RIGHT HERE AND WRONG IN `src/proxmox/index.ts`. That barrel is the package's
 *   public API and is deliberately smaller than its directory; this one's whole job is to publish
 *   everything the vendor documents.
 */
export interface Overlap {
  /** The other product's barrel, e.g. `pbs` in `pve.ts`'s header. */
  readonly other: string;
  /** How many exported names both barrels carry. */
  readonly shared: number;
}

/**
 * ⛔ THE ONE COLLISION `tsc` WILL NOT CATCH. Within a barrel a duplicate name fails to compile;
 *   across the two barrels it compiles and means two different types, so importing from the wrong
 *   file gives a type that is quietly wrong about the payload rather than an error.
 */
const overlap = (product: string, { other, shared }: Overlap): string =>
  shared === 0
    ? ''
    : `
 *
 * ⛔ ${shared} OF THESE NAMES ARE ALSO EXPORTED BY \`${other}.ts\`, MEANING SOMETHING ELSE. Both
 *   products document a \`/nodes/{node}\` subtree, so a name like \`NodesNodeCertificatesGetReturn\`
 *   exists on each side — here an array of objects, there \`null\`. Nothing stops a ${other} call
 *   importing the ${product} spelling: it compiles, and the type is simply wrong about the payload.
 *   Import from the barrel that names your product. tests/schema-types.test.ts pins this count, so
 *   a vendor upgrade that adds a collision fails there rather than at runtime.`;

export const renderBarrel = (
  entry: ManifestSchema,
  product: string,
  modules: readonly Module[],
  census: Census,
  sharing: Overlap,
): string =>
  `/**
 * Generated ${entry.product} API types — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (\`--check\` compares without writing)
${provenance(entry)}
 *
 * ${census.endpoints} endpoints, ${census.declarations} exported types: EVERY endpoint the vendor
 * documents, not a subset. The generator this replaced covered a fraction of them and no committed
 * file said which fraction or why.
 *
 * ⚠️ ${census.numeric} request parameters are typed \`\\\`\${number}\\\`\` because the vendor calls them
 *   integer or number. They were \`string\` before, which accepted 'banana'. A caller holding a
 *   number writes \\\`\${n}\\\` — \`String(n)\` is a plain \`string\` and will not typecheck, deliberately.${overlap(product, sharing)}
 */
${modules.map((module) => `export * from './${product}/${module.name}.ts';`).join('\n')}
`;
