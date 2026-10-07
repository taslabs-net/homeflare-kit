/**
 * The published entrypoint stays runtime-neutral (AGENTS.md): what a workerd or browser bundler
 * would take from the MCP SDK and from this package's own code holds no `node:`, `bun:` or bare
 * Node builtin import.
 *
 * ★ A BUNDLE, NOT A REGEX WALK. The first version of this test walked the SDK's static `import`
 *   lines with a regex and skipped every bare specifier and every dynamic `import()`, so an
 *   SDK dependency (`ajv`, `eventsource-parser`, `pkce-challenge`) gaining a `node:` import would
 *   still have passed while a workerd consumer failed at import (review of PR 328, round 2). A
 *   resolver of our own would have had to reimplement package `exports` conditions, and that is
 *   exactly where it goes wrong: `pkce-challenge` ships `index.node.js` (which imports
 *   `node:crypto`) under the `node` condition and `index.browser.js` under `browser`. So the
 *   bundler does the resolving, for the target that matters, and what is left in its output
 *   is an import the bundler could not inline: an external.
 * ⚠️ WHAT IT COVERS: the SDK's `client/index.js` and `client/streamableHttp.js` and everything
 *   they reach, and this package's `src/index.ts` with `effect` and compat left external
 *   (`effect` is the consumer's peer and compat's own imports are not this package's to assert).
 *   It does not run the code: the SDK's default validator, `ajv`, still needs `new Function`,
 *   so workerd itself stays untested (README).
 */
import { describe, expect, test } from 'bun:test';
import { builtinModules } from 'node:module';

const sdk = new URL('../node_modules/@modelcontextprotocol/sdk/dist/esm/client/', import.meta.url)
  .pathname;
const entry = new URL('../src/index.ts', import.meta.url).pathname;

/**
 * ⚠️ TARGET `node` WITH WORKERD'S CONDITIONS, NOT TARGET `browser`. Measured 2026-09-29: under
 *   `target: 'browser'` Bun POLYFILLS some builtins instead of leaving them as imports, so a
 *   `void import('node:os')` added to this package's own code passed the scan (`fs/promises` and
 *   `bun:sqlite` did not). `target: 'node'` leaves every builtin as an import, and the
 *   `conditions` pick the same builds of the SDK's dependencies a workerd bundler would
 *   (`pkce-challenge`'s `browser` build, which uses the global `crypto`, over its `node` one,
 *   which imports `node:crypto`: with no `conditions` this scan finds `node:crypto` and
 *   `node:module`, and that is what a wrong resolution looks like).
 */
const WORKERD_CONDITIONS = ['workerd', 'worker', 'browser'];

/** The specifiers still imported in a bundle: everything else was inlined. */
const externals = (bundle: string): string[] => [
  ...new Set(
    [...bundle.matchAll(/(?:\bfrom|\bimport\(|\brequire\()\s*["']([^"'./][^"']*)["']/g)].map(
      (m) => m[1] ?? '',
    ),
  ),
];

/** Node's, however spelled: `node:fs`, `bun:sqlite`, or bare `fs` and `crypto`. */
const isRuntimeSpecific = (specifier: string): boolean =>
  /^(node|bun):/.test(specifier) || builtinModules.includes(specifier.split('/')[0] ?? '');

async function bundled(
  config: Omit<Bun.BuildConfig, 'format' | 'splitting' | 'minify'>,
): Promise<{ text: string; success: boolean; logs: string[] }> {
  const result = await Bun.build({ format: 'esm', splitting: false, minify: false, ...config });
  const texts = await Promise.all(result.outputs.map((output) => output.text()));
  return { text: texts.join('\n'), success: result.success, logs: result.logs.map(String) };
}

describe('the scanner', () => {
  test('sees a node: import in a bundle, so an empty result means something', async () => {
    const { text } = await bundled({
      entrypoints: ['probe.ts'],
      files: { 'probe.ts': "import { readFileSync } from 'node:fs'; console.log(readFileSync);" },
      target: 'node',
    });
    expect(externals(text).filter(isRuntimeSpecific)).toEqual(['node:fs']);
  });

  test('and calls a bare builtin runtime-specific', () => {
    expect(['crypto', 'fs/promises', 'node:module', 'bun:sqlite'].every(isRuntimeSpecific)).toBe(
      true,
    );
    expect(['effect', 'effect/ai', 'zod/v4', 'ajv'].some(isRuntimeSpecific)).toBe(false);
  });
});

describe('a bundle resolved the way workerd resolves', () => {
  test('of the MCP SDK’s client entries imports no runtime-specific module', async () => {
    const { text, success, logs } = await bundled({
      entrypoints: [`${sdk}index.js`, `${sdk}streamableHttp.js`],
      target: 'node',
      conditions: WORKERD_CONDITIONS,
    });
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    // Sanity that the bundle is the SDK and not an empty file: the SDK's own client class is in it.
    expect(text).toContain('class Client');
    expect(externals(text).filter(isRuntimeSpecific)).toEqual([]);
  });

  test('of this package’s entrypoint (effect and compat external) imports no runtime-specific module', async () => {
    const { text, success, logs } = await bundled({
      entrypoints: [entry],
      target: 'node',
      conditions: WORKERD_CONDITIONS,
      external: ['effect', 'effect/*', '@effect/ai-openai-compat', '@effect/ai-openai-compat/*'],
    });
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain('mcpToolkit');
    const imported = externals(text);
    expect(imported.filter(isRuntimeSpecific)).toEqual([]);
    // Sanity that `external` did what it says: effect is imported, not inlined.
    expect(imported.some((s) => s.startsWith('effect/'))).toBe(true);
  });
});
