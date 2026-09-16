/**
 * ★ Worker apps inherit these flags into every imported .ts file. skipLibCheck only
 *   skips .d.ts. @cloudflare/ci and Better Auth plugins publish TypeScript source
 *   (measured 2026-09-16 on @cloudflare/ci@0.2.0: `"types": "./src/index.ts"`), so
 *   exactOptionalPropertyTypes / noImplicitOverride / noUncheckedIndexedAccess fail
 *   the consumer, not the library.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { checkProject } from '../src/check.ts';

type Tsconfig = {
  readonly extends?: string;
  readonly compilerOptions?: {
    readonly exactOptionalPropertyTypes?: boolean;
    readonly noImplicitOverride?: boolean;
    readonly noUncheckedIndexedAccess?: boolean;
  };
};

describe('tsconfig.app.json', () => {
  test('extends the strict baseline and turns off the three flags source-publishing deps fail under', async () => {
    const text = await Bun.file(new URL('../tsconfig.app.json', import.meta.url)).text();
    // tsconfigs carry comments (the reason for each flag). Bun.file().json() rejects them.
    const preset = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as Tsconfig;

    expect(preset.extends).toBe('./tsconfig.base.json');
    expect(preset.compilerOptions?.exactOptionalPropertyTypes).toBe(false);
    expect(preset.compilerOptions?.noImplicitOverride).toBe(false);
    expect(preset.compilerOptions?.noUncheckedIndexedAccess).toBe(false);
  });

  test('checkProject accepts a project that extends the app preset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-app-'));
    try {
      await writeFile(
        join(dir, 'tsconfig.json'),
        '{ "extends": "@homeflare/config/tsconfig.app.json" }',
      );

      expect((await checkProject(dir)).join('\n')).not.toContain('tsconfig.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
