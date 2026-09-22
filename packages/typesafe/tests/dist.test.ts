/**
 * Guards the BUILT artifact, not the source.
 *
 * ⚠️ THE BUG THIS EXISTS FOR, MEASURED 2026-09-15. With `"sideEffects": false` in
 *   package.json, `bun build` emitted a 126-byte dist/index.js containing only export
 *   NAMES, with every module body tree-shaken away. Tests that import src/ cannot see
 *   that. Only importing dist/ catches it.
 *
 * ⛔ Skips rather than fails when dist/ is absent: `bun test` must stay runnable without
 *   a build. CI runs `bun run build` before `bun test`, so there it is never skipped.
 */
import { describe, expect, test } from 'bun:test';

const distUrl = new URL('../dist/index.js', import.meta.url);
const built = await Bun.file(distUrl).exists();

describe.skipIf(!built)('dist/index.js', () => {
  test('exports a real createTypeSafeClient, not a tree-shaken name', async () => {
    const mod = await import(distUrl.href);

    expect(typeof mod.createTypeSafeClient).toBe('function');
    expect(typeof mod.createTypeSafeClientFromBinding).toBe('function');
    expect(typeof mod.choice).toBe('function');
    expect(typeof mod.VERSION).toBe('string');
  });

  test('VERSION matches package.json', async () => {
    const pkg = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text()) as {
      version: string;
    };
    const { VERSION } = await import(distUrl.href);

    expect(VERSION).toBe(pkg.version);
  });
});
