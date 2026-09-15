/**
 * Guards the BUILT artifact, not the source.
 *
 * ⚠️ THE BUG THIS EXISTS FOR, MEASURED 2026-09-15. With `"sideEffects": false` in
 *   package.json, `bun build` emitted a 126-byte dist/index.js containing only
 *   `export { EnvError, VERSION, parseEnv }` — the export NAMES with every module body
 *   tree-shaken away. It bundled without error, `bun test` passed (tests import src/),
 *   and tsc emitted correct .d.ts, so every other gate was green while the tarball was
 *   unusable. Only importing dist/ catches it.
 *
 * ⛔ Skips rather than fails when dist/ is absent: `bun test` must stay runnable without
 *   a build. CI runs `bun run build` before `bun test`, so there it is never skipped.
 */
import { describe, expect, test } from 'bun:test';

const distUrl = new URL('../dist/index.js', import.meta.url);
const built = await Bun.file(distUrl).exists();

describe.skipIf(!built)('dist/index.js', () => {
  test('exports real implementations, not tree-shaken names', async () => {
    const mod = await import(distUrl.href);

    expect(typeof mod.parseEnv).toBe('function');
    expect(typeof mod.EnvError).toBe('function');
    expect(typeof mod.VERSION).toBe('string');
  });

  test('the built parseEnv actually parses', async () => {
    const { parseEnv } = await import(distUrl.href);

    expect(parseEnv({ PORT: { type: 'number', default: 3000 } }, {})).toEqual({ PORT: 3000 });
    expect(parseEnv({ A: { type: 'boolean' } }, { A: 'false' })).toEqual({ A: false });
  });

  test('VERSION matches package.json', async () => {
    const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json();
    const { VERSION } = await import(distUrl.href);

    expect(VERSION).toBe(pkg.version);
  });
});
