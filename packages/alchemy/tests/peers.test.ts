/**
 * The peer contract, asserted in three places at once.
 *
 * 🔴 WHY. 0.1.0 shipped with a smoke script that could not fail, and 0.1.1 shipped with
 *   `cloudflare` marked optional while the `/cloudflare` subpath could not load without
 *   it. Both got through because the README's install command and the smoke test's
 *   install command DISAGREED — the smoke test installed `cloudflare`, the README's
 *   pinned line did not mention it, and nothing compared them.
 * ⛔ So this compares them. A peer the manifest declares must appear in the peer doc and in
 *   the smoke install, or one of the three is lying to a consumer.
 * ★ The single source of truth is now `homeflare.consumer` in this package's manifest.
 *   docs/peers.md, the smoke-test install and the published contract must stay equal;
 *   this file reads all three and fails on any drift.
 */
import { describe, expect, test } from 'bun:test';
import {
  deriveImportMoves,
  parseSmokeInstallPins,
  parseSmokePins,
  workspacePackages,
} from './peer-contract-helper';

const root = new URL('../', import.meta.url);
const rootPkg = (await Bun.file(new URL('../../../package.json', import.meta.url)).json()) as {
  catalog?: Record<string, string>;
  overrides?: Record<string, string>;
};
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  homeflare: {
    consumer: {
      pins: Record<string, string>;
      overrides: Record<string, string>;
      importMoves: Record<string, string>;
      unresolved: string[];
    };
  };
};
const peerDoc = await Bun.file(new URL('docs/peers.md', root)).text();
const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();
const rcExports = (await Bun.file(
  new URL('tests/fixtures/effect-exports-rc.115.json', root),
).json()) as Record<string, unknown>;
const effectExports = (await Bun.file(
  new URL('../../../node_modules/effect/package.json', import.meta.url),
).json()) as { exports: Record<string, unknown> };

const consumer = pkg.homeflare.consumer;
const repoRoot = new URL('../../../', import.meta.url);

const distilledCoreVersions = new Set<string>();
for await (const { manifest } of workspacePackages(repoRoot, 'packages/*/package.json')) {
  const v = manifest.dependencies?.['@distilled.cloud/core'];
  if (v !== undefined) distilledCoreVersions.add(v);
}
if (distilledCoreVersions.size !== 1) {
  throw new Error(
    `expected one @distilled.cloud/core version across workspace packages, got ${[...distilledCoreVersions].join(', ') || 'none'}`,
  );
}
const [distilledCore] = [...distilledCoreVersions] as [string];

/** Parse the JSON block inside `docs/peers.md`. */
function peerDocOverrides(): Record<string, string> {
  const block = peerDoc.match(/```json\s*(\{\s*"overrides"\s*:\s*\{[\s\S]*?\}\s*\})\s*```/);
  expect(block).not.toBeNull();
  if (block === null || block[1] === undefined) {
    throw new Error('docs/peers.md overrides block not found');
  }
  return (JSON.parse(block[1]) as { overrides: Record<string, string> }).overrides;
}

describe('peer contract', () => {
  test('every peer appears in the install instructions in docs/peers.md', () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(peerDoc).toContain(name);
    }
  });

  test('every peer is installed by the smoke test', () => {
    // ⛔ THE GAP THAT LET 0.1.1 SHIP. If the smoke test installs something the README
    //   omits, it proves an install no consumer will ever perform.
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(smoke).toContain(name);
    }
  });

  test('peers are pinned, and every peer is in the consumer contract', () => {
    // ⚠️ Measured 2026-09-16: `>=4.0.0-rc.112` resolved to rc.115 against Alchemy 77
    //   and Config.string vanished. Alchemy 78 requires rc.115; pin the pair, do not range.
    for (const [name, version] of Object.entries(pkg.peerDependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(consumer.pins[name] ?? '').toBe(version);
    }
  });

  test('the distilled SDK peer is exactly the version alchemy itself pins', async () => {
    // ★ MeshNode calls `@distilled.cloud/cloudflare` directly, the SDK alchemy's own Cloudflare
    //   providers use. alchemy pins it as a plain dependency; a different peer here would load a
    //   second copy, and a stale one would break the next alchemy bump at import, not at install.
    const installed = (await Bun.file(
      new URL('../node_modules/alchemy/package.json', import.meta.url),
    ).json()) as { dependencies: Record<string, string> };
    const pinned = installed.dependencies['@distilled.cloud/cloudflare'];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.peerDependencies['@distilled.cloud/cloudflare']).toBe(pinned ?? '');
  });

  test('no peer is marked optional', () => {
    // ⛔ An optional peer should mean a FEATURE is absent without it. Every peer here is
    //   needed for its subpath to load at all — `cloudflare` was marked optional in 0.1.1
    //   and `/cloudflare` threw "Cannot find package" without it.
    expect(pkg.peerDependenciesMeta ?? {}).toEqual({});
  });

  test('docs/peers.md tells consumers about the overrides block and the consumer field', () => {
    // Pinned peers are not enough: platform-node-shared resolves up transitively.
    expect(peerDoc).toContain('overrides');
    expect(peerDoc).toContain('@effect/platform-node-shared');
    expect(peerDoc).toContain('homeflare.consumer');
  });

  test('the smoke install pins match the consumer contract pins', () => {
    // ⛔ THE GAP THAT LET 0.1.1 SHIP (versions). If the smoke script installs a peer at a
    //   different version than the contract, the smoke proves a tree no consumer will get.
    const installed = parseSmokeInstallPins(smoke);
    expect(new Set(Object.keys(installed))).toEqual(new Set(Object.keys(pkg.peerDependencies)));
    for (const [name, version] of Object.entries(installed)) {
      expect(consumer.pins[name] ?? '').toBe(version);
    }
  });

  test('the docs/peers.md overrides block matches the consumer contract', () => {
    // ⛔ Drift here means a consumer follows the peer doc and installs something the published
    //   manifest no longer promises; or the manifest promises something the peer doc hides.
    expect(peerDocOverrides()).toEqual(consumer.overrides);
  });

  test('the smoke test PINS match the consumer contract in both directions', () => {
    // ⛔ A one-directional check misses overrides dropped from the contract but left in
    //   the smoke install, which is exactly the README/smoke disagreement class this
    //   suite exists to prevent.
    expect(parseSmokePins(smoke)).toEqual(consumer.overrides);
  });

  test('overrides.effect equals the pin, so the override cannot drift off the peer', () => {
    expect(consumer.overrides.effect ?? '').toBe(consumer.pins.effect ?? '');
  });

  test('overrides pin rolldown to an exact tarball, not a floating tilde', () => {
    // 🔴 Measured 2026-09-16 on main CI after #39: `bun add` in the smoke scratch
    //   (no lockfile) installed alchemy's optional peer vite@^8, whose
    //   `rolldown: ~1.2.6` resolved to 1.2.9 and npm 404'd the tarball. The fix moved
    //   to an exact pin; the consumer contract now owns it.
    expect(consumer.overrides.rolldown ?? '').toBe('1.2.8');
    expect(peerDocOverrides()).toHaveProperty('rolldown', '1.2.8');
  });

  test('overrides pin redis to the complete sub-package set, not a floating peer', () => {
    // 🔴 Measured 2026-09-30 on #335's CI: redis@6.3.0 hit npm before its own
    //   @redis/time-series@6.3.0, so a lockfile-less install floating the
    //   peer failed outright for that window. Exact stays.
    expect(consumer.overrides.redis ?? '').toBe('6.3.0');
    expect(peerDocOverrides()).toHaveProperty('redis', '6.3.0');
  });

  test('consumer pins are exact and track the kit catalog or overrides', () => {
    // ★ The contract is curated: some pins come from the root catalog (effect, alchemy, mime),
    //   platform-* from root overrides, and the distilled packages from the version this repo's
    //   workspace pins. Every value must be traceable to a single authoritative location.
    const catalog = rootPkg.catalog ?? {};
    const overrides = rootPkg.overrides ?? {};

    for (const [name, version] of Object.entries(consumer.pins)) {
      if (name in catalog) {
        expect(version).toBe(catalog[name] ?? '');
      } else if (name in overrides) {
        expect(version).toBe(overrides[name] ?? '');
      } else if (name === '@distilled.cloud/core') {
        // core is a dependency of every distilled-* interim package; it is not a direct peer.
        expect(version).toBe(distilledCore);
      } else {
        expect(name in pkg.peerDependencies).toBe(true);
      }
    }
  });

  test('every workspace package with a kit-family peer pins it to the contract', async () => {
    // ★ site, seat-runtime and the distilled-* interim packages all peer effect at the same
    //   exact version. A different exact peer anywhere splits the graph this contract exists
    //   to prevent. This is discovered from the tree, not listed by hand.
    const drifted: { name: string | undefined; version: string }[] = [];
    for await (const { name, manifest } of workspacePackages(repoRoot, 'packages/*/package.json')) {
      const version = manifest.peerDependencies?.effect;
      if (version !== undefined && version !== consumer.pins.effect) {
        drifted.push({ name, version });
      }
    }
    expect(drifted).toEqual([]);
  });
});

describe('consumer import moves', () => {
  test('importMoves are derived from rc.115 to the installed effect exports', () => {
    const { importMoves: derivedMoves, unresolved } = deriveImportMoves(rcExports, effectExports);

    // ⛔ httpapi must be first in the published order (the rest follow alphabetical order).
    expect(derivedMoves['effect/unstable/httpapi/']).toBe('effect/http-api/');
    expect(consumer.importMoves).toEqual(derivedMoves);
    const httpapiKey = 'effect/unstable/httpapi/';
    const expectedKeys = [
      httpapiKey,
      ...Object.keys(derivedMoves)
        .filter((k) => k !== httpapiKey)
        .sort(),
    ];
    expect(Object.keys(consumer.importMoves)).toEqual(expectedKeys);
    expect(consumer.unresolved).toEqual(unresolved);
  });
});
