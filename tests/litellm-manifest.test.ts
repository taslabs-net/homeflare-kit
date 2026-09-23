/**
 * The `litellm-openapi` schema entry, and whether the generated pass-through types are still true
 * of it. Same two-layer shape as `tests/netbox-manifest.test.ts`: layer one needs no cached schema
 * and runs in CI; layer two re-verifies the sha256 and regenerates, and SKIPS with a printed
 * command when the 1.7 MB document is not cached — a skip that says what did not run, not a
 * silent pass.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const GENERATED = join(ROOT, 'packages/alchemy/src/litellm/generated/pass-through.ts');

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
const entry = manifest.schemas.find((s) => s.id === 'litellm-openapi') as Entry;
const cacheDir = (process.env['HOMEFLARE_SCHEMA_CACHE'] ?? manifest.cacheDir).replace(
  /^~/,
  homedir(),
);
const cached = existsSync(join(cacheDir, entry.file));

describe('the litellm-openapi entry says what it is true of', () => {
  test('it names the version, the sha256 and how it was produced', () => {
    expect(entry).toBeDefined();
    expect(entry.version).toBe('1.100.0');
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.consumedBy).toContain('packages/alchemy/src/litellm/generated/pass-through.ts');
  });

  /** ⛔ NOT a live read — the note records why, and what the byte-identical cross-check does and does not cover. */
  test('the note records the cross-check, and what it does not cover', () => {
    expect(entry.note).toContain('CROSS-CHECKED byte-identically');
    expect(entry.note).toContain('does NOT cover');
  });
});

describe('the generated pass-through types carry their source', () => {
  test('the header names the entry, the version and the sha256 prefix, and forbids hand edits', async () => {
    const text = await Bun.file(GENERATED).text();
    expect(text).toContain(entry.id);
    expect(text).toContain(entry.version);
    expect(text).toContain(entry.sha256.slice(0, 16));
    expect(text).toContain('DO NOT EDIT BY HAND');
  });

  test('it is under the house cap of 250 lines', async () => {
    const text = await Bun.file(GENERATED).text();
    expect(text.split('\n').length).toBeLessThanOrEqual(250);
  });

  test('every operation the header names is a litellm:<METHOD> <path> key', async () => {
    const text = await Bun.file(GENERATED).text();
    for (const line of text.split('\n')) {
      const match = /^\s\*\s+(litellm:.+)$/.exec(line);
      if (match !== null) expect(match[1]).toMatch(/^litellm:(GET|POST|PUT|PATCH|DELETE) \//);
    }
  });
});

describe('the committed types are current against the document they name', () => {
  /** ⛔ THE DIGEST-EQUIVALENT: regenerating from the cached schema must reproduce this file byte for byte. */
  test.skipIf(!cached)('bun codegen/litellm.ts --check reports no stale file', () => {
    const run = Bun.spawnSync(['bun', 'codegen/litellm.ts', '--check'], { cwd: ROOT });
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output).toContain('current');
    expect(run.exitCode).toBe(0);
  });

  test('the skip, when it happens, says exactly how to make it run', () => {
    if (cached) return;
    // oxlint-disable-next-line no-console -- the point of this branch is to tell the operator.
    console.log(
      `schema cache absent (${entry.file}) — staleness check skipped. Re-fetch per ` +
        'codegen/README.md, then run `bun codegen/litellm.ts --check`.',
    );
    expect(entry.sha256.length).toBe(64);
  });
});

describe('the generator refuses a key the vendor does not have', () => {
  test.skipIf(!cached)(
    'a bogus operation key stops the generator rather than emitting an empty row',
    async () => {
      const { requireOperation } = await import('../codegen/litellm-emit.ts');
      const { readManifest, verifiedText } = await import('../codegen/schema-cache.ts');
      const doc = JSON.parse(await verifiedText(await readManifest(), 'litellm-openapi')) as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(() =>
        requireOperation(doc as never, 'POST', '/config/pass_through_endpoint/does-not-exist'),
      ).toThrow(/has no POST/);
    },
  );
});
