/**
 * The vendor schema manifest, and whether the committed tables are still true of it.
 *
 * ⛔ PROVENANCE IS THE RULE THIS ENFORCES (Tim, 2026-09-22): "we need to never guess and make sure
 *   we always note which version of the schemas we are against". Every entry names the product
 *   version the HOST reports, the sha256 of the bytes that were read, the role of the host and the
 *   absolute path on it — never an estate hostname, because this is a public repository.
 *
 * ★ TWO LAYERS, BECAUSE THEY CATCH DIFFERENT THINGS.
 *   1. ALWAYS: the manifest's own shape, and that every generated table names an entry that exists.
 *      No schema file needed, so it runs in CI.
 *   2. WHEN THE CACHE IS PRESENT: `bun codegen/constraints.ts --check` re-verifies each sha256 and
 *      regenerates into memory. A committed table that no longer matches the schema FAILS here.
 *      ⚠️ SKIPPED, NOT FAILED, when the cache is absent: the raw schemas are 5.8 MB of
 *        vendor-authored JavaScript deliberately kept out of git, and a CI runner has none. The
 *        skip prints the command, so nobody has to guess what did not run.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import coverageManifest from '../schemas/manifest.json' with { type: 'json' };

const ROOT = join(import.meta.dir, '..');
const GENERATED = join(ROOT, 'packages/alchemy/src/proxmox/generated/constraints');

interface Entry {
  readonly id: string;
  readonly vendor: string;
  readonly product: string;
  readonly version: string;
  readonly sourceRole: string;
  readonly sourcePath: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly fetchedAt: string;
  readonly consumedBy: readonly string[];
  /** ⚠️ Only on an entry fetched from a public git repository, never from a host. */
  readonly sourceBlobSha1?: string;
}

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as {
  cacheDir: string;
  schemas: readonly Entry[];
};

const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);

describe('every schema entry says what it is true of', () => {
  test('the four required provenance fields are present and shaped', () => {
    expect(manifest.schemas.length).toBeGreaterThan(0);
    for (const entry of manifest.schemas) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.version).not.toBe('');
      expect(entry.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(entry.sourcePath).not.toBe('');
      expect(entry.sourceRole).not.toBe('');
    }
  });

  /**
   * ⛔ A PUBLIC REPOSITORY. A node name, an address or a UniFi console id in this file would be an
   *   estate detail published forever in the git history. The role plus the absolute path is
   *   enough to re-fetch and carries nothing about which box answered.
   */
  test('no estate hostname, address or console id is recorded', () => {
    /**
     * ⚠️ THE HASH FIELDS ARE THE ONLY PLACE A LONG HEX STRING BELONGS, so they come out first.
     *   ⛔ STRIPPED BY FIELD NAME, NOT BY PATTERN — that is what keeps the guarantee. A hex id
     *     smuggled into `note`, `sourcePath` or `version` still trips the check below; only a
     *     field this test knows is a content hash is exempt. `sourceBlobSha1` is the vendor's own
     *     git blob id for a file in a PUBLIC repository, which is how a reader fetches exactly
     *     the bytes the sha256 describes.
     */
    const text = JSON.stringify(
      manifest.schemas.map(({ sha256, sourceBlobSha1, ...rest }) => rest),
    );
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/[a-z0-9-]+\.(?:mgmt\.)?homeflare\.dev/);
    expect(text).not.toMatch(/\b[0-9a-f]{40,}\b/);
  });

  test('a consumed schema names generated files that all exist', () => {
    for (const entry of manifest.schemas) {
      for (const file of entry.consumedBy) expect(existsSync(join(ROOT, file))).toBe(true);
    }
  });

  /** ⚠️ Recorded as available and generated from by nothing — the gap list stops guessing. */
  test('both UniFi documents are recorded with their versions and consumed by nothing', () => {
    const unifi = manifest.schemas.filter((entry) => entry.vendor === 'Ubiquiti');
    expect(unifi.map((entry) => `${entry.id} ${entry.version}`).sort()).toEqual([
      'unifi-network 10.4.57',
      'unifi-site-manager 1.0.0',
    ]);
    expect(unifi.every((entry) => entry.consumedBy.length === 0)).toBe(true);
  });
});

describe('the generated tables carry their source in their header', () => {
  test('each one names its manifest entry, product version and sha256 prefix', async () => {
    for (const entry of manifest.schemas) {
      for (const file of entry.consumedBy) {
        const text = await Bun.file(join(ROOT, file)).text();
        expect(text).toContain(entry.id);
        expect(text).toContain(entry.version);
        expect(text).toContain(entry.sha256.slice(0, 16));
        expect(text).toContain('DO NOT EDIT BY HAND');
      }
    }
  });

  test('no generated file is over the house cap of 250 lines', async () => {
    for (const name of ['index.ts', 'pbs-config.ts', 'pve-access.ts', 'pve-cluster.ts']) {
      const text = await Bun.file(join(GENERATED, name)).text();
      expect(text.split('\n').length).toBeLessThanOrEqual(250);
    }
  });
});

describe('the committed tables are current against the schemas they name', () => {
  const missing = manifest.schemas
    .filter((entry) => entry.consumedBy.length > 0)
    .filter((entry) => !existsSync(join(cacheDir, entry.file)));

  test.skipIf(missing.length > 0)(
    'bun codegen/constraints.ts --check reports no stale file',
    async () => {
      const run = Bun.spawnSync(['bun', 'codegen/constraints.ts', '--check'], { cwd: ROOT });
      const output = `${run.stdout.toString()}${run.stderr.toString()}`;
      expect(output).toContain('current');
      expect(run.exitCode).toBe(0);
    },
  );

  test('the skip, when it happens, says exactly how to make it run', () => {
    if (missing.length === 0) return;
    // oxlint-disable-next-line no-console -- the point of this branch is to tell the operator.
    console.log(
      `schema cache absent (${missing.map((e) => e.file).join(', ')}) — staleness check skipped. ` +
        'Re-fetch read-only per codegen/README.md, then run `bun codegen/constraints.ts --check`.',
    );
    expect(missing.every((entry) => entry.sha256.length === 64)).toBe(true);
  });
});

/**
 * ⛔ TWO MANIFESTS, ONE REPOSITORY, AND THEY MUST NAME THE SAME BYTES. `codegen/manifest.json`
 *   feeds the constraint tables and `schemas/manifest.json` feeds `docs/api-coverage.*`; they were
 *   written hours apart and landed pointing at DIFFERENT PVE schemas — 9.2.11 and 9.2.4, from a
 *   genuinely mixed-version cluster, differing by two write endpoints. A reader comparing the two
 *   artefacts was comparing two APIs, and nothing said so. Measured and corrected 2026-09-22.
 */
describe('the two schema manifests describe the same vendor bytes', () => {
  const coverage = coverageManifest as {
    entries: readonly { id: string; sha256: string; version: string; cacheFile: string }[];
  };
  const pairs = [
    { codegen: 'pve-apidoc', coverage: 'proxmox/pve' },
    { codegen: 'pbs-apidoc', coverage: 'proxmox/pbs' },
  ];

  for (const pair of pairs) {
    test(`${pair.codegen} and ${pair.coverage} agree on sha256, version and cache file`, () => {
      const a = manifest.schemas.find((s) => s.id === pair.codegen);
      const b = coverage.entries.find((e) => e.id === pair.coverage);
      // ⛔ THE BYTES AND THE FILE, EXACTLY. A second filename for the same bytes is how an
      //   unversioned `pve-apidoc.js` stayed in the cache holding a stale 9.2.4 copy.
      expect([a?.sha256, a?.file]).toEqual([b?.sha256, b?.cacheFile]);
      // ⚠️ THE VERSION STRINGS DIFFER BY THE PRODUCT NAME, which codegen keeps in its own field:
      //   `9.2.11/f699…` against `pve-manager/9.2.11/f699…`. Containment is the honest assertion.
      expect(b?.version).toContain(a?.version ?? 'MISSING');
    });
  }
});

/**
 * ⛔ AN UNREADABLE PARAMETER SCHEMA MUST NOT BECOME AN EMPTY TABLE. That is how
 *   `Proxmox.HaRule` ended up with a guard that checked nothing: PVE wraps its parameters in
 *   `allOf`/`oneOf`, the reader asked for `properties`, and `{}` looks exactly like "no rules".
 */
describe('the parameter reader says so when it cannot read', () => {
  test('allOf merges, oneOf intersects, and anything else is reported', async () => {
    const { resolveParameters } = await import('../codegen/parameters.ts');
    expect(
      resolveParameters({ allOf: [{ properties: { a: {} } }, { properties: { b: {} } }] }),
    ).toMatchObject({ params: { a: {}, b: {} } });
    // Only what BOTH branches state, and a disagreeing `optional` becomes optional.
    const both = resolveParameters({
      oneOf: [
        { properties: { keep: { maxLength: 4 }, only: {} } },
        { properties: { keep: { maxLength: 4, optional: 1 } } },
      ],
    });
    expect(Object.keys(both.params)).toEqual(['keep']);
    expect(both.params['keep']).toEqual({ maxLength: 4, optional: 1 });
    expect(resolveParameters({ anyOf: [] }).unresolved).toContain('anyOf');
  });
});
