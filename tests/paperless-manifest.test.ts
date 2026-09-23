/**
 * The Paperless schema entry, and whether the committed tables and types are still true of it.
 *
 * ★ SAME TWO LAYERS AS `netbox-manifest.test.ts`. Layer one needs no schema file and runs in CI;
 *   layer two re-verifies the sha256 and regenerates into memory, and SKIPS with the printed
 *   fetch command when the cache is absent.
 *
 * ⛔ THIS FILE FAILS WITHOUT THE UNIT: `codegen/manifest.json` had no `paperless-openapi` entry,
 *   and `packages/alchemy/src/paperless/index.ts` did not exist.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PAPERLESS_CONSTRAINTS,
  PAPERLESS_CONSTRAINTS_DIGEST,
} from '../packages/alchemy/src/paperless/index.ts';

const ROOT = join(import.meta.dir, '..');

interface Entry {
  readonly id: string;
  readonly version: string;
  readonly versionCommand: string;
  readonly sourceRole: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly note?: string;
  readonly consumedBy: readonly string[];
}

const manifest = (await Bun.file(join(ROOT, 'codegen/manifest.json')).json()) as {
  cacheDir: string;
  schemas: readonly Entry[];
};
const entry = manifest.schemas.find((s) => s.id === 'paperless-openapi') as Entry;
const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);

describe('the Paperless entry says what it is true of', () => {
  test('the ground-truth measurements this unit made', () => {
    expect(entry).toBeDefined();
    expect(entry.version).toBe('3.1.1');
    expect(entry.sha256).toBe('d0fe550d2135e37b6846ec96ddafcf18395a5c9e433075d217745c35e1d8a830');
    expect(entry.bytes).toBe(722398);
  });

  /** ⛔ The version comes from the HOST's version.py, never the document's own `info.version`. */
  test('the versionCommand says the version is NOT info.version', () => {
    expect(entry.versionCommand).toContain('version.py');
    expect(entry.versionCommand).toContain('NEVER');
    expect(entry.versionCommand).toContain('info.version');
  });

  /** ⛔ A ROLE, never a hostname or address — this repository is public. */
  test('the source is a role, not a hostname', () => {
    expect(entry.sourceRole).toBe('Paperless-ngx web service, loopback');
    expect(entry.sourceRole).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(entry.sourceRole).not.toMatch(/\.(com|net|org|local|internal)\b/);
  });

  test('the note records what the served-document provenance rests on, and what it does not cover', () => {
    expect(entry.note).toContain('byte-identical');
    expect(entry.note).toContain('does NOT cover request bodies');
  });
});

describe('the generated Paperless files carry their source', () => {
  test('every consumed file names the manifest id, version and sha256 prefix, and forbids hand edits', async () => {
    for (const file of entry.consumedBy) {
      const text = await Bun.file(join(ROOT, file)).text();
      expect(text).toContain(entry.id);
      expect(text).toContain(entry.version);
      expect(text).toContain(entry.sha256.slice(0, 16));
      expect(text).toContain('DO NOT EDIT BY HAND');
    }
  });

  test('no generated file is over the house cap of 250 lines', async () => {
    for (const name of entry.consumedBy) {
      const text = await Bun.file(join(ROOT, name)).text();
      expect(text.split('\n').length).toBeLessThanOrEqual(250);
    }
  });

  test('the coverage report is under the document cap and says it is generated', async () => {
    const text = await Bun.file(join(ROOT, 'docs/paperless-coverage.md')).text();
    expect(text.split('\n').length).toBeLessThanOrEqual(200);
    expect(text).toContain('DO NOT EDIT BY HAND');
  });
});

describe('the merged table is reachable and self-describing', () => {
  test('every key is prefixed paperless:', () => {
    const keys = Object.keys(PAPERLESS_CONSTRAINTS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('paperless:')).toBe(true);
  });

  test('the committed digest matches the committed data — a hand-edited value fails this', async () => {
    const { digest } = await import('../codegen/emit.ts');
    expect(digest(PAPERLESS_CONSTRAINTS)).toBe(PAPERLESS_CONSTRAINTS_DIGEST);
  });
});

describe('the committed tables and types are current against the document they name', () => {
  const cached = existsSync(join(cacheDir, entry.file));

  test.skipIf(!cached)('bun codegen/paperless.ts --check reports no stale file', () => {
    const run = Bun.spawnSync(['bun', 'codegen/paperless.ts', '--check'], { cwd: ROOT });
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output).toContain('current');
    expect(run.exitCode).toBe(0);
  });

  test('the skip, when it happens, says exactly how to make it run', () => {
    if (cached) return;
    // oxlint-disable-next-line no-console -- the point of this branch is to tell the operator.
    console.log(
      `schema cache absent (${entry.file}) — staleness check skipped. Re-fetch: curl -fsS ` +
        `'http://127.0.0.1:28981/api/schema/?format=json' > ${join(cacheDir, entry.file)}, ` +
        'then run `bun codegen/paperless.ts --check`.',
    );
    expect(entry.sha256.length).toBe(64);
  });
});
