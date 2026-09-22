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
    // ⚠️ The sha256 fields are the ONE place a long hex string belongs, so they come out first.
    const text = JSON.stringify(manifest.schemas.map(({ sha256, ...rest }) => rest));
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
