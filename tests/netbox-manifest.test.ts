/**
 * The NetBox schema entry, and whether the committed tables are still true of it.
 *
 * ★ SAME TWO LAYERS AS `schema-manifest.test.ts`, FOR THE SAME REASON. Layer one needs no schema
 *   file and therefore runs in CI; layer two re-verifies the sha256 and regenerates into memory,
 *   and SKIPS with a printed command when the 14 MB document is not cached. A skip that says what
 *   did not run is honest; a silent pass is not.
 *
 * ⛔ THE ONE THING THIS FILE EXISTS TO STOP is a hand-edited constraint. The digest is computed
 *   from the DATA, so reformatting is not a failure while changing a 200 to a 201 by hand is.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  NETBOX_CONSTRAINTS,
  NETBOX_CONSTRAINTS_DIGEST,
} from '../packages/alchemy/src/netbox/index.ts';

const ROOT = join(import.meta.dir, '..');
const GENERATED = join(ROOT, 'packages/alchemy/src/netbox/generated/constraints');

interface Entry {
  readonly id: string;
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
  readonly note?: string;
  readonly consumedBy: readonly string[];
}

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as {
  cacheDir: string;
  schemas: readonly Entry[];
};
const entry = manifest.schemas.find((s) => s.id === 'netbox-openapi') as Entry;
const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);

describe('the NetBox entry says what it is true of', () => {
  test('it names the version, the sha256 and the release tag it was pinned to', () => {
    expect(entry).toBeDefined();
    expect(entry.version).toBe('4.7.0');
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * ⛔ THE REASON THE DOCUMENT IS NOT A LIVE READ IS PART OF THE PROVENANCE, NOT A FOOTNOTE. An
   *   entry that merely said "vendor repository" would read as a choice; it was a constraint, and
   *   the next person deserves to know which.
   */
  test('the note records that it was cross-checked, and what that did NOT verify', () => {
    expect(entry.note).toContain('CROSS-CHECKED');
    expect(entry.note).toContain('PATH surface only');
  });
});

describe('the generated NetBox tables carry their source', () => {
  test('the table names its entry, version and sha256 prefix, and forbids hand edits', async () => {
    for (const file of entry.consumedBy) {
      const text = await Bun.file(join(ROOT, file)).text();
      expect(text).toContain(entry.id);
      expect(text).toContain(entry.version);
      expect(text).toContain(entry.sha256.slice(0, 16));
      expect(text).toContain('DO NOT EDIT BY HAND');
    }
  });

  test('no generated file is over the house cap of 250 lines', async () => {
    for (const name of ['index.ts', 'netbox-ipam.ts']) {
      const text = await Bun.file(join(GENERATED, name)).text();
      expect(text.split('\n').length).toBeLessThanOrEqual(250);
    }
  });

  /** ⚠️ Documents are capped at 200, and the report is a document. */
  test('the coverage report is under the document cap and says it is generated', async () => {
    const text = await Bun.file(join(ROOT, 'docs/netbox-coverage.md')).text();
    expect(text.split('\n').length).toBeLessThanOrEqual(200);
    expect(text).toContain('DO NOT EDIT BY HAND');
  });
});

describe('the merged table is reachable and self-describing', () => {
  test('every key is prefixed netbox: so it cannot collide with another vendor', () => {
    const keys = Object.keys(NETBOX_CONSTRAINTS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('netbox:')).toBe(true);
  });

  /**
   * ⛔ THE VALUE A HAND EDIT WOULD CHANGE. The digest is over the data, so this fails on a
   *   silently retyped bound and not on a reformat.
   */
  test('the committed digest matches the committed data', async () => {
    const { digest } = await import('../codegen/emit.ts');
    expect(digest(NETBOX_CONSTRAINTS)).toBe(NETBOX_CONSTRAINTS_DIGEST);
  });
});

describe('the committed tables are current against the document they name', () => {
  const cached = existsSync(join(cacheDir, entry.file));

  test.skipIf(!cached)('bun codegen/netbox.ts --check reports no stale file', () => {
    const run = Bun.spawnSync(['bun', 'codegen/netbox.ts', '--check'], { cwd: ROOT });
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output).toContain('current');
    expect(run.exitCode).toBe(0);
  });

  test('the skip, when it happens, says exactly how to make it run', () => {
    if (cached) return;
    // oxlint-disable-next-line no-console -- the point of this branch is to tell the operator.
    console.log(
      `schema cache absent (${entry.file}) — staleness check skipped. Re-fetch per ` +
        'codegen/README.md, then run `bun codegen/netbox.ts --check`.',
    );
    expect(entry.sha256.length).toBe(64);
  });
});
