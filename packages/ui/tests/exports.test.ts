/**
 * Guards @homeflare/ui's published contract.
 *
 * ⚠️ AN OUTSIDE REVIEW CAUGHT ALL OF THIS, 2026-09-15: a comment claiming Kumo was
 *   re-exported when it was not, Kumo as a dependency rather than a peer, required peers
 *   Kumo itself marks optional, no CSS export, and a smoke script that echoed and exited
 *   0. Each assertion below is one of those findings.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  exports: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
};

describe('@homeflare/ui', () => {
  test('Kumo is a PEER, never a dependency', () => {
    // ⛔ A dependency lets two Kumo versions coexist in one tree — two stylesheets, two
    //   Base UI instances. Consumers import Kumo directly, so one copy must win.
    expect(pkg.peerDependencies?.['@cloudflare/kumo']).toBeDefined();
    expect(pkg.dependencies?.['@cloudflare/kumo']).toBeUndefined();
  });

  test('does not require the peers Kumo marks optional', () => {
    // ⚠️ Measured on Kumo 2.13.2: zod and echarts are optional peers there. Requiring
    //   them made every consumer install a chart library to render a Button.
    expect(pkg.peerDependencies?.['echarts']).toBeUndefined();
    expect(pkg.peerDependencies?.['zod']).toBeUndefined();
  });

  test('exposes ./styles, and the JS entry imports no CSS', async () => {
    expect(pkg.exports['./styles']).toBe('./styles/index.css');

    // ⛔ Automatic CSS breaks any consumer whose bundler cannot handle it — a Worker
    //   bundling for workerd, or an SSR pass loading this module for its types.
    const entry = await Bun.file(new URL('src/index.ts', root)).text();
    expect(entry).not.toContain(".css'");
  });

  test('the stylesheet pulls in Kumo and layers HomeFlare tokens', async () => {
    const css = await Bun.file(new URL('styles/index.css', root)).text();

    expect(css).toContain("@import '@cloudflare/kumo/styles'");
    expect(css).toContain('--hf-');
  });

  test('never claims to re-export Kumo', async () => {
    // ⚠️ The header used to say "KUMO IS RE-EXPORTED HERE" three lines above code saying
    //   it was not. A doc that contradicts the code is worse than no doc.
    const entry = await Bun.file(new URL('src/index.ts', root)).text();

    // ⚠️ ASSERT ON CODE, NOT ON TEXT. Twice now a substring ban matched the DOC rather
    //   than the code: the header correctly says "KUMO IS NOT RE-EXPORTED" and correctly
    //   shows `import … from '@cloudflare/kumo/components/button'` as the example. So
    //   strip comments first, then check what is left.
    const code = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('@cloudflare/kumo');
    expect(entry).toContain('KUMO IS NOT RE-EXPORTED');
  });

  test('ships styles, and its smoke test can actually fail', async () => {
    expect(pkg.files).toContain('styles');

    // ⛔ The placeholder echoed and exited 0 — coverage that proves nothing.
    expect(pkg.scripts['smoke']).toContain('scripts/smoke.ts');
    const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();
    expect(smoke).toContain('renderToString');
  });
});
