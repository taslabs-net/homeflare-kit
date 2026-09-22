/**
 * The committed Proxmox API types, held to the schemas they name.
 *
 * ⛔ THE FAILURE THIS IS FOR. `generated/{pve,pbs}.ts` said `Run: bun codegen/generate.ts` and that
 *   file existed at no commit — `git log --oneline --all -- 'codegen/generate*'` was empty. So the
 *   types could not be reproduced, could not be corrected, and named no version. They covered 407
 *   of PVE's 678 endpoints and 46 of PBS's 367 with nothing recorded about which 407, and they
 *   widened every integer request parameter to `string`.
 *
 * ★ THREE LAYERS, BECAUSE THEY CATCH DIFFERENT THINGS.
 *   1. ALWAYS: provenance in every generated header, the barrel matching the files on disk, the
 *      house cap, and the named list of files that cannot meet it. No schema file needed.
 *   2. ALWAYS: coverage — the barrels state a count, and the count is checked against the files.
 *   3. WHEN THE CACHE IS PRESENT: `bun codegen/types.ts --check` regenerates into memory and fails
 *      on any stale or orphaned file. ⚠️ SKIPPED, NOT FAILED, without the cache: the raw schemas
 *      are 5.8 MB deliberately kept out of git, and a CI runner has none.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NUMERIC_STRING } from '../codegen/tsmap.ts';

const ROOT = join(import.meta.dir, '..');
const GENERATED = join(ROOT, 'packages/alchemy/src/proxmox/generated');
const REFRESH = 'bun codegen/types.ts';

interface Entry {
  readonly id: string;
  readonly product: string;
  readonly version: string;
  readonly sha256: string;
  readonly file: string;
}

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as {
  cacheDir: string;
  schemas: readonly Entry[];
};

const entry = (id: string): Entry => manifest.schemas.find((s) => s.id === id) as Entry;
const PRODUCTS = [
  { id: 'pve-apidoc', product: 'pve' },
  { id: 'pbs-apidoc', product: 'pbs' },
] as const;

const modulesOf = (product: string): readonly string[] =>
  readdirSync(join(GENERATED, product)).sort();

const read = async (path: string): Promise<string> => Bun.file(join(GENERATED, path)).text();

/**
 * ⛔ THE ONLY FILES ALLOWED OVER THE HOUSE CAP, AND WHY. Each holds the endpoints of ONE vendor
 *   path whose parameters carry enums of hundreds of members — `mp0`…`mp255` and `unused0`…
 *   `unused255` for the volume moves, the ACME DNS provider list for the plugins, the QEMU CPU
 *   model list. A single type declaration is the smallest unit there is, so the cap cannot be met
 *   by splitting; dropping the enum would widen the parameter back to `string`, which is the
 *   defect this generator exists to remove. A NINTH entry here is a real change, not a formality.
 */
const OVER_CAP = [
  'pve/cluster-acme-plugins-id.ts',
  'pve/cluster-acme-plugins.ts',
  'pve/cluster-qemu-custom-cpu-models-cputype.ts',
  'pve/cluster-qemu-custom-cpu-models.ts',
  'pve/nodes-node-lxc-vmid-move-volume.ts',
  'pve/nodes-node-lxc-vmid-resize.ts',
  'pve/nodes-node-qemu-vmid-config.ts',
  'pve/nodes-node-qemu-vmid-move-disk.ts',
];

describe('every generated type file says what it is true of', () => {
  for (const { id, product } of PRODUCTS) {
    test(`${product}: the barrel and every module name the manifest entry and its sha256`, async () => {
      const source = entry(id);
      for (const path of [`${product}.ts`, ...modulesOf(product).map((n) => `${product}/${n}`)]) {
        const text = await read(path);
        expect(text, `${path} does not name its manifest entry`).toContain(source.id);
        expect(text, `${path} does not name the product version`).toContain(source.version);
        expect(text, `${path} does not carry the sha256 prefix`).toContain(
          source.sha256.slice(0, 16),
        );
        expect(text).toContain('DO NOT EDIT BY HAND');
        expect(text).toContain(REFRESH);
      }
    });

    /**
     * ⛔ A MODULE THE BARREL DOES NOT EXPORT IS A TYPE NOBODY CAN IMPORT, and a barrel line with no
     *   file behind it does not compile. Both are what a half-applied regeneration looks like.
     */
    test(`${product}: the barrel exports exactly the modules on disk`, async () => {
      const barrel = await read(`${product}.ts`);
      const exported = [...barrel.matchAll(/export \* from '\.\/[a-z]+\/([\w-]+\.ts)';/g)]
        .map((match) => match[1] as string)
        .sort();
      expect(exported).toEqual([...modulesOf(product)]);
    });
  }
});

describe('the split meets the house cap, and says so where it cannot', () => {
  test('only the named files are over 250 lines', async () => {
    const over: string[] = [];
    for (const { product } of PRODUCTS) {
      for (const name of modulesOf(product)) {
        const text = await read(`${product}/${name}`);
        if (text.split('\n').length > 250) over.push(`${product}/${name}`);
      }
    }
    expect(over.sort()).toEqual(OVER_CAP);
  });

  test('each file over the cap explains itself in its own header', async () => {
    for (const path of OVER_CAP) {
      const text = await read(path);
      expect(text, `${path} is over the cap and does not say so`).toContain('OVER THE HOUSE CAP');
    }
  });

  test('the barrels are well under the cap, because they are only re-exports', async () => {
    for (const { product } of PRODUCTS) {
      expect((await read(`${product}.ts`)).split('\n').length).toBeLessThanOrEqual(250);
    }
  });
});

describe('coverage is the whole vendor schema, not an unexplained subset', () => {
  for (const { product } of PRODUCTS) {
    test(`${product}: the endpoint count the barrel claims is the count on disk`, async () => {
      const claimed = Number(/^ \* (\d+) endpoints/m.exec(await read(`${product}.ts`))?.[1]);
      expect(claimed).toBeGreaterThan(0);
      let found = 0;
      for (const name of modulesOf(product)) {
        const text = await read(`${product}/${name}`);
        found += new Set(
          [...text.matchAll(/^\/\*\* ((?:GET|POST|PUT|DELETE) \S+)/gm)].map((m) => m[1] as string),
        ).size;
      }
      expect(found).toBe(claimed);
    });
  }

  /**
   * ⚠️ ENDPOINTS THE OLD GENERATOR LEFT OUT, NAMED ONE BY ONE. It covered 407 of PVE's 678 and 46
   *   of PBS's 367; these five were among the missing, and a regression that quietly narrows
   *   coverage again would pass every count-based test above.
   */
  test('endpoints the previous generator omitted are present now', async () => {
    const wanted: readonly [string, string][] = [
      ['pve/cluster.ts', 'GET /cluster'],
      ['pve/cluster-notifications.ts', 'GET /cluster/notifications/matcher-fields'],
      ['pbs/access.ts', 'PUT /access/acl'],
      ['pbs/admin.ts', 'GET /admin/datastore'],
      ['pbs/tape.ts', 'GET /tape'],
    ];
    for (const [path, endpoint] of wanted) {
      expect(existsSync(join(GENERATED, path)), `${path} is missing`).toBe(true);
      expect(await read(path), `${path} does not document ${endpoint}`).toContain(
        `/** ${endpoint}`,
      );
    }
  });

  /**
   * 🔴 THE EMPTY-TABLE DEFECT, IN ITS TYPE FORM. PVE spells `POST /cluster/ha/rules` as
   *   `allOf: [{properties}, {oneOf: […]}]`, so a reader that asks for `parameters.properties`
   *   sees nothing and emits a type with no fields — indistinguishable from an endpoint that
   *   takes nothing. `codegen/parameters.ts` resolves both combinators; two PVE endpoints need
   *   it, and they carry twelve parameters that were otherwise absent.
   * ⚠️ ONLY WHAT EVERY `oneOf` BRANCH STATES SURVIVES. `affinity` is in the resource-affinity
   *   branch and `comment` in both, so a type claiming a rule from one branch would refuse a
   *   legal declaration of the other kind.
   */
  test('a parameter schema wrapped in allOf/oneOf is read, not emitted empty', async () => {
    const text = await read('pve/cluster-ha.ts');
    expect(text).toContain('export type ClusterHaRulesPostParams = {');
    expect(text).toContain("  affinity?: 'positive' | 'negative';");
    expect(text).toContain('  comment?: string;');
    expect(text).not.toContain('export type ClusterHaRulesPostParams = {};');
  });

  /**
   * ⛔ THE WIDENING, PINNED WHERE IT WAS MEASURED. `pbs:POST /config/verify`'s `max-depth` is
   *   `integer, minimum 0, maximum 7`; the committed type said `'max-depth'?: string`.
   */
  test('an integer request parameter is a numeric string, not any string', async () => {
    const text = await read('pbs/config-verify.ts');
    expect(text).toContain(`'max-depth'?: ${NUMERIC_STRING};`);
    expect(text).not.toContain("'max-depth'?: string;");
    // ⚠️ The RESPONSE keeps the real number — the two directions are not the same value.
    expect(text).toContain("'max-depth'?: number;");
  });
});

describe('the committed types are current against the schemas they name', () => {
  const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
    /^~/,
    homedir(),
  );
  const missing = PRODUCTS.map(({ id }) => entry(id)).filter(
    (source) => !existsSync(join(cacheDir, source.file)),
  );

  test.skipIf(missing.length > 0)(`${REFRESH} --check reports no stale file`, () => {
    const run = Bun.spawnSync(['bun', 'codegen/types.ts', '--check'], { cwd: ROOT });
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output, output).toContain('current');
    expect(run.exitCode).toBe(0);
  });

  test('the skip, when it happens, says exactly how to make it run', () => {
    if (missing.length === 0) return;
    // oxlint-disable-next-line no-console -- the point of this branch is to tell the operator.
    console.log(
      `schema cache absent (${missing.map((s) => s.file).join(', ')}) — type staleness check ` +
        `skipped. Re-fetch read-only per codegen/README.md, then run \`${REFRESH} --check\`.`,
    );
    expect(missing.every((source) => source.sha256.length === 64)).toBe(true);
  });
});
