/**
 * The pairing, read from what is INSTALLED rather than from what is declared.
 *
 * 🔴 WHY EXACT AND SAME-RC. Effect release candidates break each other (measured 2026-09-16:
 *   `>=4.0.0-rc.112` resolved to rc.115 and `Config.string` vanished), and rc.118 dropped the
 *   `unstable/` prefix outright (`effect/unstable/ai` became `effect/ai`; rc.116 and rc.117
 *   keep it). `@effect/ai-openai-compat` peers on `effect ^4.0.0-rc.X`, so a caret happily
 *   admits a newer effect than the one this code was typechecked against. The scout measured
 *   effect rc.115 with compat rc.115 clean (install, tsc 7.0.2, runtime), and mixed with
 *   compat beta.107 installing but unproven beyond one surface, so the rule stays same-rc.
 * ⛔ A version bump therefore moves FOUR places together — the catalog, this package's
 *   dependency and peer, and the root overrides — and this file is what fails when one lags.
 */
import { describe, expect, test } from 'bun:test';

type Manifest = {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly overrides?: Record<string, string>;
  readonly catalog?: Record<string, string>;
};

const read = async (url: URL): Promise<Manifest> => (await Bun.file(url).json()) as Manifest;
const pkg = await read(new URL('../package.json', import.meta.url));
const rootPkg = await read(new URL('../../../package.json', import.meta.url));
// The workspace links each package's own dependencies under its node_modules.
const effect = await read(new URL('../node_modules/effect/package.json', import.meta.url));
const compat = await read(
  new URL('../node_modules/@effect/ai-openai-compat/package.json', import.meta.url),
);
const sdk = await read(
  new URL('../node_modules/@modelcontextprotocol/sdk/package.json', import.meta.url),
);
const lock = await Bun.file(new URL('../../../bun.lock', import.meta.url)).text();

const PIN = '4.0.0-rc.115';

describe('installed versions', () => {
  test('effect and @effect/ai-openai-compat are the same exact rc', () => {
    expect(effect.version).toBe(PIN);
    expect(compat.version).toBe(PIN);
    expect(compat.version).toBe(effect.version);
  });

  test('the installed effect satisfies the range compat peers on', () => {
    const range = compat.peerDependencies?.['effect'] ?? '';
    expect(range).toMatch(/rc\.\d+/);
    expect(Bun.semver.satisfies(effect.version ?? '', range)).toBe(true);
  });
});

describe('declared pins', () => {
  test('the peer, the dependency and the catalog all say the same rc', () => {
    expect(pkg.peerDependencies?.['effect']).toBe(PIN);
    expect(pkg.dependencies?.['@effect/ai-openai-compat']).toBe(PIN);
    expect(rootPkg.catalog?.['effect']).toBe(PIN);
    expect(rootPkg.catalog?.['@effect/ai-openai-compat']).toBe(PIN);
  });

  test('nothing else is a runtime dependency', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      '@effect/ai-openai-compat',
      '@modelcontextprotocol/sdk',
    ]);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(['effect']);
  });
});

describe('the platform-node-shared trap', () => {
  // 🔴 MEASURED 2026-09-29 (scout, pair115). `@effect/platform-bun@rc.115` depends on
  //   `@effect/platform-node-shared ^rc.115`, which bun resolves to rc.118 on a fresh install;
  //   rc.118 imports `effect/process/ChildProcess`, a path effect rc.115 does not have, so the
  //   process dies at import. This package imports neither, but every consumer that adds
  //   platform-bun beside it meets the trap.
  // ⚠️ AND AN `overrides` FIELD IN THIS PACKAGE'S OWN package.json CANNOT FIX IT. Measured
  //   2026-09-29 in a scratch workspace: bun honours `overrides` only in the ROOT manifest, so a
  //   member's copy resolved rc.118 anyway, and installing a tarball whose manifest carried it
  //   resolved rc.118 too. Hence no such field here: the pin lives where it works — the kit's
  //   root (asserted below), and the consumer's root (README, and scripts/smoke.ts proves it).
  test('the kit root pins it to the same rc as effect', () => {
    expect(rootPkg.overrides?.['@effect/platform-node-shared']).toBe(PIN);
    expect(rootPkg.overrides?.['effect']).toBe(PIN);
  });

  test('the lockfile resolves it to that rc and no other', () => {
    const resolved = [...lock.matchAll(/"@effect\/platform-node-shared@([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(resolved.length).toBeGreaterThan(0);
    expect(new Set(resolved)).toEqual(new Set([PIN]));
  });

  test('this package declares no `overrides`, because it would do nothing', () => {
    expect(pkg.overrides).toBeUndefined();
  });
});

describe('the MCP SDK pairing', () => {
  // ★ 1.31.0 IS WHAT THE SCOUT MEASURED (2026-09-29, pair115: list, call and resource read
  //   against an Effect McpServer) and what `npm view` named current that day. It is a plain
  //   pinned dependency, not a peer: this package's `mcpToolkit` is the only thing that
  //   imports it, and a consumer should not have to choose a version.
  const SDK = '@modelcontextprotocol/sdk';

  test('the dependency, the catalog and the installed copy are one exact version', () => {
    expect(pkg.dependencies?.[SDK]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rootPkg.catalog?.[SDK]).toBe(pkg.dependencies?.[SDK]);
    expect(sdk.version).toBe(pkg.dependencies?.[SDK]);
  });

  test('the kit’s zod satisfies the range the SDK peers on', () => {
    // 🔴 The SDK's `zod` is a NON-optional peer (`^3.25 || ^4.0`, 1.31.0). A kit zod outside that
    //   range would make bun install a second copy for the SDK, and two zods in one process is
    //   the classic "schema from another copy" failure.
    const range = sdk.peerDependencies?.['zod'] ?? '';
    expect(range).not.toBe('');
    expect(Bun.semver.satisfies(rootPkg.catalog?.['zod'] ?? '', range)).toBe(true);
  });

  test('the lockfile resolves exactly one zod', () => {
    const versions = [...lock.matchAll(/^ {4}"zod": \["zod@([^"]+)"/gm)].map((m) => m[1]);
    expect(versions).toEqual([rootPkg.catalog?.['zod']]);
    // No copy nested under the SDK (bun writes those as "<parent>/zod").
    expect(lock).not.toContain('"@modelcontextprotocol/sdk/zod"');
  });

  test('the SDK’s client entry pulls no node: or bun: module at import time', async () => {
    // ⛔ The published entry point stays runtime-neutral (AGENTS.md). The scout read the import
    //   graph of client/index.js and client/streamableHttp.js: 16 files, no node: specifier.
    const root = new URL('../node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url);
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = async (file: URL): Promise<void> => {
      if (seen.has(file.href)) return;
      seen.add(file.href);
      const text = await Bun.file(file).text();
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1] ?? '';
        if (spec.startsWith('.')) await walk(new URL(spec, file));
        else if (/^(node|bun):/.test(spec)) bad.push(`${file.pathname} -> ${spec}`);
      }
    };
    await walk(new URL('client/index.js', root));
    await walk(new URL('client/streamableHttp.js', root));
    expect(seen.size).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});
