/**
 * Guards the dependency catalog.
 *
 * ★ THE CATALOG IS THE SINGLE-VERSION RULE, MECHANISED — one entry per package for the
 *   whole repo, so two packages can never resolve the same dependency at different
 *   versions.
 *
 * ⛔ BUT ONLY devDependencies MAY SAY `catalog:`. Measured 2026-09-15: `npm pack` leaves
 *   the string `catalog:` untouched — only `bun pm pack` resolves it — and
 *   `changeset publish` shells out to npm. A catalogued RUNTIME dependency therefore
 *   publishes as the literal `"catalog:"`, and every consumer install dies with
 *   EUNSUPPORTEDPROTOCOL. Changesets' catalog support is changesets/changesets#2213,
 *   still open.
 *   ⚠️ The smoke test caught this, and nothing else did: bun installed the workspace
 *     happily, lint/types/tests were all green, and only packing the tarball and
 *     installing it with npm showed the failure.
 */
import { describe, expect, test } from 'bun:test';

type Manifest = {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly catalog?: Record<string, string>;
};

const root = new URL('../', import.meta.url);
const rootPkg = (await Bun.file(new URL('package.json', root)).json()) as Manifest;
const catalog = rootPkg.catalog ?? {};

/**
 * Every published workspace package, DISCOVERED rather than listed.
 * ⚠️ A hand list here went stale silently: @homeflare/alchemy was never in it, so none of
 *   these checks had ever looked at its manifest. Same lesson as scripts/sync-versions.ts.
 */
const PACKAGES: readonly string[] = await Array.fromAsync(
  new Bun.Glob('packages/*/package.json').scan({ cwd: root.pathname }),
).then((paths) => paths.map((path) => path.split('/')[1] ?? '').sort());

/**
 * Peers pinned EXACTLY, on purpose, per package. ⛔ Each entry is a measured exception to
 * "peer ranges stay ranges", not a convenience:
 * - Effect release candidates break each other (measured 2026-09-16: `>=4.0.0-rc.112`
 *   resolved to rc.115 and `Config.string` vanished), and Alchemy's betas pin one rc.
 *   packages/alchemy/tests/peers.test.ts and packages/site/tests/contract.test.ts hold
 *   the per-package reasoning.
 * - `mime` is pinned by @homeflare/alchemy alongside the Alchemy 78/79 install line.
 * - `@distilled.cloud/cloudflare` is pinned to the exact version alchemy itself pins (a plain
 *   dependency there), so MeshNode shares alchemy's copy of the SDK rather than a second one.
 *   packages/alchemy/tests/peers.test.ts asserts the two stay equal.
 */
const EXACT_PEERS: Readonly<Record<string, readonly string[]>> = {
  alchemy: ['@distilled.cloud/cloudflare', '@effect/platform-node', 'alchemy', 'effect', 'mime'],
  site: ['effect'],
};

async function manifest(name: string): Promise<Manifest> {
  return (await Bun.file(new URL(`packages/${name}/package.json`, root)).json()) as Manifest;
}

describe('catalog', () => {
  test('is not empty and pins exact versions', () => {
    expect(Object.keys(catalog).length).toBeGreaterThan(10);

    for (const [name, version] of Object.entries(catalog)) {
      // A ranged entry defeats the point: two packages resolving `^1.2.0` at different
      // times get different versions. Peer-only entries are the deliberate exception.
      if (name === 'echarts') continue;
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test('no PUBLISHED field says catalog:', async () => {
    for (const pkg of PACKAGES) {
      const m = await manifest(pkg);

      for (const field of ['dependencies', 'peerDependencies'] as const) {
        for (const [, spec] of Object.entries(m[field] ?? {})) {
          expect(spec).not.toBe('catalog:');
        }
      }
    }
  });

  test('published runtime deps match the catalog exactly', async () => {
    // ★ This is what keeps the catalog authoritative despite the literals: a version
    //   bumped in one place and not the other fails here rather than shipping.
    for (const pkg of PACKAGES) {
      const deps = (await manifest(pkg)).dependencies ?? {};

      for (const [name, spec] of Object.entries(deps)) {
        if (spec.startsWith('workspace:')) continue;
        // ⚠️ noUncheckedIndexedAccess types catalog[name] as possibly-undefined even
        //   after the `in` guard; the ?? keeps the assertion honest.
        if (name in catalog) expect(spec).toBe(catalog[name] ?? '');
      }
    }
  });

  test('peer ranges stay ranges', async () => {
    // ⛔ A peer pinned to one exact version rejects every consumer on any other — the
    //   catalog pins what WE install, a peer declares what a consumer may bring.
    for (const pkg of PACKAGES) {
      const peers = (await manifest(pkg)).peerDependencies ?? {};
      const exact = EXACT_PEERS[pkg] ?? [];

      for (const [name, spec] of Object.entries(peers)) {
        if (exact.includes(name)) expect(spec).toMatch(/^\d+\.\d+\.\d+/);
        else expect(spec).toMatch(/^[\^>~]|\|\|/);
      }
    }
  });

  test('the package list is discovered, and covers every package', () => {
    expect(PACKAGES).toContain('alchemy');
    expect(PACKAGES).toContain('site');
    expect(PACKAGES.length).toBeGreaterThanOrEqual(8);
  });

  test('the lockfile does not pin @cloudflare/* to the internal registry', async () => {
    // 🔴 MEASURED 2026-09-16. Local bun install with ~/.npmrc pointing @cloudflare at
    //   registry-gateway.cloudflare-ui.workers.dev rewrote bun.lock tarball URLs to that
    //   host. CI has no token, so `bun install --frozen-lockfile` 401s on kumo / workers-types
    //   / workerd. Main's lockfile uses the default registry (empty URL). A private URL
    //   here is a laptop-only install that every consumer and every CI job cannot perform.
    const lock = await Bun.file(new URL('bun.lock', root)).text();
    expect(lock).not.toContain('registry-gateway.cloudflare-ui.workers.dev');
  });

  test('devDependencies DO use the catalog', async () => {
    // They never ship, so the protocol is safe there — and that is where the
    // single-version rule earns its keep across the published packages.
    const rootDev = rootPkg.devDependencies ?? {};
    const used = Object.values(rootDev).filter((s) => s === 'catalog:');

    expect(used.length).toBeGreaterThan(0);
  });
});
