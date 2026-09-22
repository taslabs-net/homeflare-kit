/**
 * Which generated file each endpoint's declarations land in.
 *
 * ★ SPLIT BY THE VENDOR'S OWN PATH, DEEPENING ONLY WHERE A FILE WOULD BE TOO BIG. `/nodes` alone
 *   is 6,600 lines of PVE, so it deepens to `nodes-node-qemu.ts`, `nodes-node-lxc.ts` and so on —
 *   a reader with the API viewer open knows which file to open without a map. `render.ts` splits
 *   the constraint tables the same way; this one recurses because the type files are an order of
 *   magnitude larger.
 *
 * ⛔ THREE PVE ENDPOINTS CANNOT BE SPLIT SMALL ENOUGH, AND THEY ARE NAMED RATHER THAN HIDDEN.
 *   `POST /nodes/{node}/lxc/{vmid}/move_volume` declares `volume` AND `target-volume` as 513-member
 *   enums (`rootfs`, `mp0`…`mp255`, `unused0`…`unused255`); `POST /nodes/{node}/qemu/{vmid}/move_disk`
 *   and `PUT /nodes/{node}/lxc/{vmid}/resize` do the same with one such parameter each. That is the
 *   vendor's schema, measured on pve-manager 9.2.11. A single type declaration is the smallest unit
 *   there is, so the house cap cannot be met by splitting further, and the alternatives are worse:
 *   dropping the enum WIDENS the parameter back to `string`, which is the exact defect this
 *   generator exists to fix, and re-flowing it to fill 100 columns makes one added mount point
 *   rewrite forty lines. So a file holding exactly ONE endpoint is allowed over the cap, it says so
 *   in its own header, and `tests/schema-types.test.ts` pins the list — a fourth one shows up as a
 *   failing test rather than as silent growth.
 */
import type { Block } from './types-endpoint.ts';

/** The house cap for a code file. Same number `render.ts` enforces for the constraint tables. */
export const CAP = 250;

export interface Module {
  /** `nodes-node-qemu` — the file is `<product>/<name>.ts`. */
  readonly name: string;
  readonly blocks: readonly Block[];
  /** True when this module is a single endpoint that is bigger than the cap on its own. */
  readonly irreducible: boolean;
}

/** `['nodes', 'node', 'qemu']` -> `nodes-node-qemu`. A path with no segments is the product root. */
const moduleName = (prefix: readonly string[]): string =>
  prefix.length === 0 ? 'root' : prefix.join('-');

const bodyLines = (blocks: readonly Block[]): number =>
  blocks.reduce((total, block) => total + block.lines + 1, 0);

/**
 * Group at `depth`, then re-split any group that is still too big.
 *
 * ⚠️ AN ENDPOINT SHORTER THAN `depth` STAYS PUT. `/nodes` has one segment, so splitting the
 *   `nodes` group at depth 2 leaves `GET /nodes` in `nodes.ts` while everything under
 *   `/nodes/{node}` moves to `nodes-node.ts`. Forcing it deeper would file the collection endpoint
 *   away from the collection.
 */
const group = (blocks: readonly Block[], depth: number, budget: number): readonly Module[] => {
  const buckets = new Map<string, Block[]>();
  for (const block of blocks) {
    const name = moduleName(block.segments.slice(0, depth));
    buckets.set(name, [...(buckets.get(name) ?? []), block]);
  }
  const out: Module[] = [];
  for (const [name, bucket] of [...buckets].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const over = bodyLines(bucket) > budget;
    // ⛔ THE RECURSION IS BOUNDED BY THE LONGEST PATH IN THE BUCKET, NOT BY THE BUDGET. Several
    //   endpoints share one path — `GET`, `PUT` and `DELETE` of `/cluster/ha/rules/{rule}` are
    //   three blocks with identical segments — so a bucket can be over budget and still have no
    //   deeper split. Without this test `group` recurses on the same bucket until the stack ends.
    const divisible = bucket.some((block) => block.segments.length > depth);
    if (!over || !divisible) {
      out.push({ blocks: bucket, irreducible: over, name });
      continue;
    }
    out.push(...group(bucket, depth + 1, budget));
  }
  return out;
};

/** How much of `/nodes/{node}/lxc` and `/nodes/{node}/qemu` is the same area: `nodes-node`. */
const commonPrefix = (left: string, right: string): string => {
  const a = left.split('-');
  const b = right.split('-');
  const out: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    out.push(a[i] as string);
  }
  return out.join('-');
};

/**
 * Merge neighbouring modules back together while they still fit.
 *
 * ⛔ WITHOUT THIS, ONE OVERSIZED ENDPOINT FRAGMENTS ITS WHOLE BRANCH. `group` deepens an entire
 *   bucket when the bucket is too big, so `POST /nodes/{node}/lxc/{vmid}/move_volume` — 1,040
 *   lines on its own because of a 513-member vendor enum — used to push every one of its ~90
 *   siblings into a file of its own. 199 files for PVE, most of them a dozen lines. The split
 *   should be as deep as the cap requires and no deeper.
 *
 * ⚠️ ONLY ADJACENT MODULES MERGE, AND THE LIST IS SORTED BY NAME, so a merge is always between two
 *   neighbours in the same area and the result keeps the vendor's own ordering.
 */
const pack = (modules: readonly Module[], budget: number): readonly Module[] => {
  const out = [...modules];
  for (let i = 0; i + 1 < out.length;) {
    const left = out[i] as Module;
    const right = out[i + 1] as Module;
    const prefix = commonPrefix(left.name, right.name);
    const blocks = [...left.blocks, ...right.blocks];
    // ⚠️ THE SHARED PREFIX IS OFTEN ALREADY A FILE — `/nodes/{node}/ceph` is an endpoint of its own
    //   as well as the parent of a dozen others — and reusing the name would overwrite it. The
    //   merged file then keeps the LEFT neighbour's name, which is a real vendor path, is unique
    //   because that module is being consumed, and sorts next to what it holds.
    const taken = out.some(
      (module, index) => index !== i && index !== i + 1 && module.name === prefix,
    );
    const name = taken ? left.name : prefix;
    if (left.irreducible || right.irreducible || prefix === '' || bodyLines(blocks) > budget) {
      i++;
      continue;
    }
    out.splice(i, 2, { blocks, irreducible: false, name });
  }
  return out;
};

/**
 * Every module for one product: split until each fits, then packed back up so the split is no
 * deeper than the cap requires.
 *
 * `budget` is the cap minus the header these files carry, because a provenance header is part of
 * the file the house cap counts.
 */
export const split = (blocks: readonly Block[], budget: number): readonly Module[] =>
  pack(group(blocks, 1, budget), budget);
