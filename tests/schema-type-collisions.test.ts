/**
 * The one way a generated type can be wrong that the compiler will not say a word about.
 *
 * ⛔ WITHIN A PRODUCT, A DUPLICATE NAME IS A BUILD ERROR. `generated/pve.ts` is `export *` over 56
 *   files, so two vendor paths collapsing to one type name breaks `tsc` in a file nobody edited —
 *   and `codegen/types.ts`'s `checkNames` catches it first and names both paths.
 * 🔴 ACROSS THE TWO PRODUCTS, THE SAME NAME COMPILES AND MEANS SOMETHING ELSE. `pve.ts` and
 *   `pbs.ts` are separate barrels. Both vendors document a `/nodes/{node}` subtree, so
 *   `NodesNodeCertificatesGetReturn` exists on each side — `readonly Record<string, unknown>[]` in
 *   PVE, `null` in PBS. A PBS call typed with the PVE spelling builds clean and is simply wrong
 *   about the payload, and no per-product check can see it.
 * ⚠️ THIS ARRIVED WITH FULL COVERAGE, WHICH IS WHY IT IS PINNED RATHER THAN ASSUMED HARMLESS. The
 *   646 + 69 declarations the previous generator emitted shared ZERO names; 1059 + 560 share 135.
 *   Renaming them would churn exports that are correct inside their own barrel, so the count is
 *   recorded in both barrel headers and held here: a vendor upgrade that adds one fails this test
 *   instead of handing someone a type that lies.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GENERATED = join(import.meta.dir, '../packages/alchemy/src/proxmox/generated');
const PRODUCTS = ['pve', 'pbs'] as const;
const REFRESH = 'bun codegen/types.ts';

/**
 * ⛔ MEASURED FROM THE FILES ON DISK, NOT FROM THE GENERATOR. A test that re-ran the pipeline would
 *   agree with itself whatever the committed tree says, and the committed tree is what consumers
 *   import.
 */
const exportsOf = (product: string): ReadonlySet<string> => {
  const dir = join(GENERATED, product);
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^export type (\w+)/gm)) {
      names.add(match[1] as string);
    }
  }
  return names;
};

const [PVE, PBS] = PRODUCTS.map(exportsOf) as [ReadonlySet<string>, ReadonlySet<string>];
const SHARED = [...PVE].filter((name) => PBS.has(name)).sort();

/**
 * How many names both barrels export. A NEW collision is a real change: it means a vendor upgrade
 * gave one product a path the other already had, and someone has to decide whether the two types
 * can keep the same spelling.
 */
const EXPECTED_SHARED = 135;

/** The one command that prints the overlap, so a failure is one paste away from the actual names. */
const LIST_THEM =
  "names() { grep -ho '^export type [A-Za-z0-9_]*' packages/alchemy/src/proxmox/generated/$1/*.ts" +
  " | cut -d' ' -f3 | sort -u; }; comm -12 <(names pve) <(names pbs)";

describe('the two product barrels do not quietly disagree about a name', () => {
  test(`exactly ${String(EXPECTED_SHARED)} names are exported by both barrels`, () => {
    // ⚠️ THE MESSAGE NAMES A RUNNABLE COMMAND, NOT ALL 135 NAMES. A failure that prints the whole
    //   list buries the one or two that actually changed; `comm` prints exactly the overlap.
    expect(
      SHARED.length,
      `pve.ts and pbs.ts now share ${String(SHARED.length)} names, not ${String(EXPECTED_SHARED)}. ` +
        `Re-run \`${REFRESH}\`, then list the overlap with:\n  ${LIST_THEM}\n` +
        'Update EXPECTED_SHARED and say in the changeset which names moved and whether the two ' +
        'sides still mean different things.',
    ).toBe(EXPECTED_SHARED);
  });

  /**
   * ⛔ THE HEADER IS THE ONLY PLACE A READER MEETS THIS. If the generator's count and the files'
   *   count drift apart, the warning is worse than none: it is a number that sounds measured.
   */
  for (const product of PRODUCTS) {
    test(`${product}.ts states the shared count it actually has`, () => {
      const header = readFileSync(join(GENERATED, `${product}.ts`), 'utf8');
      const claimed = Number(/ \* ⛔ (\d+) OF THESE NAMES ARE ALSO EXPORTED BY/.exec(header)?.[1]);
      expect(claimed, `${product}.ts does not warn about the shared names at all`).toBe(
        SHARED.length,
      );
      expect(header).toContain('Import from the barrel that names your product.');
    });
  }

  /**
   * ⚠️ THE SHARED NAMES ARE NOT HARMLESS SYNONYMS — THAT IS THE WHOLE HAZARD. If a vendor upgrade
   *   ever made every one of them identical, the warning in the headers could go.
   * ⛔ THE SPLIT ITSELF IS NOT PINNED TO A NUMBER, ON PURPOSE. How many differ depends on where a
   *   regex decides one declaration ends, and a test that reports 62 or 76 depending on its own
   *   parser is a test that flaps rather than one that measures. The hazard is proven by a NAMED
   *   pair instead: one name, two payloads that share nothing.
   */
  test('a shared name can mean two entirely different payloads', () => {
    const body = (product: string, name: string): string => {
      const dir = join(GENERATED, product);
      for (const file of readdirSync(dir)) {
        const text = readFileSync(join(dir, file), 'utf8');
        const found = new RegExp(`^export type ${name} = (.*?);$`, 'm').exec(text);
        if (found !== null) return found[1] as string;
      }
      return '';
    };
    expect(body('pve', 'NodesNodeCertificatesGetReturn')).toBe(
      'readonly Record<string, unknown>[]',
    );
    expect(body('pbs', 'NodesNodeCertificatesGetReturn')).toBe('null');
    expect(SHARED.some((name) => body('pve', name) !== body('pbs', name))).toBe(true);
  });
});
