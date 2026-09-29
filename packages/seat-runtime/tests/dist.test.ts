/**
 * Guards the BUILT artifact, not the source.
 *
 * ⚠️ THE BUG THIS EXISTS FOR, MEASURED 2026-09-15 in @homeflare/kit: with
 *   `"sideEffects": false`, `bun build` emitted export NAMES with every module body
 *   tree-shaken away. Tests that import src/ cannot see that; only importing dist/ can.
 *   ★ Here it also proves `export * as SeatModel` survives bundling as a real namespace.
 *
 * ⛔ Skips rather than fails when dist/ is absent, so `bun test` runs without a build.
 *   CI runs `bun run build` before `bun test`, so there it is never skipped.
 */
import { describe, expect, test } from 'bun:test';

const indexUrl = new URL('../dist/index.js', import.meta.url);
const built = await Bun.file(indexUrl).exists();

describe.skipIf(!built)('dist/', () => {
  test('exports real functions and layers, not tree-shaken names', async () => {
    const { SeatModel, SeatObs } = await import(indexUrl.href);
    for (const name of ['layer', 'embeddingLayer', 'clientLayer']) {
      expect(typeof SeatModel[name]).toBe('function');
    }
    expect(SeatObs.layer).toBeDefined();
    expect(SeatObs.CT100_ENDPOINTS.traces).toContain('/insert/opentelemetry/v1/traces');
  });

  test('the round loop, the MCP toolkit and its error survive bundling', async () => {
    const { runRounds, mcpToolkit, McpToolkitError } = await import(indexUrl.href);
    expect(typeof runRounds).toBe('function');
    expect(typeof mcpToolkit).toBe('function');
    const error = new McpToolkitError({
      operation: 'connect',
      server: 'http://x/mcp',
      cause: 'no',
    });
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('McpToolkitError');
  });

  test('the built layer builds', async () => {
    const { SeatModel } = await import(indexUrl.href);
    expect(
      SeatModel.layer({ model: 'm', apiUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', tags: ['a:b'] }),
    ).toBeDefined();
  });

  test('VERSION matches package.json', async () => {
    const pkg = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text()) as {
      version: string;
    };
    expect((await import(indexUrl.href)).VERSION).toBe(pkg.version);
  });
});
