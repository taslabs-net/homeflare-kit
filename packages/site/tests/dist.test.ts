/**
 * Guards the BUILT artifact, not the source.
 *
 * ⚠️ THE BUG THIS EXISTS FOR, MEASURED 2026-09-15 in @homeflare/kit: with
 *   `"sideEffects": false`, `bun build` emitted export NAMES with every module body
 *   tree-shaken away. Tests that import src/ cannot see that; only importing dist/ can.
 *
 * ⚠️ TWO ENTRYPOINTS, ONE SiteError. `index` and `load` are separate bundles. Without
 *   `--splitting`, each carries its own copy of the SiteError class, and a consumer's
 *   `error instanceof SiteError` (imported from the main entry) is FALSE for every
 *   refusal `loadSite` throws — measured 2026-09-21 under node, `false` without the flag
 *   and `true` with it. That is why `build:js` passes `--splitting` and the other packages'
 *   builds do not. The last test here is that check.
 *
 * ⛔ Skips rather than fails when dist/ is absent, so `bun test` runs without a build.
 *   CI runs `bun run build` before `bun test`, so there it is never skipped.
 */
import { describe, expect, test } from 'bun:test';

const indexUrl = new URL('../dist/index.js', import.meta.url);
const loadUrl = new URL('../dist/load.js', import.meta.url);
const built = (await Bun.file(indexUrl).exists()) && (await Bun.file(loadUrl).exists());

describe.skipIf(!built)('dist/', () => {
  test('exports real functions, not tree-shaken names', async () => {
    const mod = await import(indexUrl.href);
    for (const name of ['decodeSite', 'derive', 'pins', 'compareIdentity', 'tokenValues']) {
      expect(typeof mod[name]).toBe('function');
    }
    // An Effect schema is callable; what proves it survived bundling is its AST.
    expect(mod.SiteSchema?.ast?._tag).toBe('Objects');
    expect(typeof (await import(loadUrl.href)).loadSite).toBe('function');
  });

  test('VERSION matches package.json', async () => {
    const pkg = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text()) as {
      version: string;
    };
    expect((await import(indexUrl.href)).VERSION).toBe(pkg.version);
  });

  test('a refusal from /load is an instance of the main entry’s SiteError', async () => {
    const { SiteError } = await import(indexUrl.href);
    const { loadSite } = await import(loadUrl.href);
    let caught: unknown;
    try {
      await loadSite({ env: {}, siteDev: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SiteError);
  });
});
