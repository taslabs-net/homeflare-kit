/**
 * The peer contract, asserted in three places at once.
 *
 * 🔴 WHY. 0.1.0 shipped with a smoke script that could not fail, and 0.1.1 shipped with
 *   `cloudflare` marked optional while the `/cloudflare` subpath could not load without
 *   it. Both got through because the README's install command and the smoke test's
 *   install command DISAGREED — the smoke test installed `cloudflare`, the README's
 *   pinned line did not mention it, and nothing compared them.
 * ⛔ So this compares them. A peer the manifest declares must appear in the README and in
 *   the smoke install, or one of the three is lying to a consumer.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const readme = await Bun.file(new URL('README.md', root)).text();
const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();

describe('peer contract', () => {
  test('every peer appears in the README install', () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(readme).toContain(name);
    }
  });

  test('every peer is installed by the smoke test', () => {
    // ⛔ THE GAP THAT LET 0.1.1 SHIP. If the smoke test installs something the README
    //   omits, it proves an install no consumer will ever perform.
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(smoke).toContain(name);
    }
  });

  test('peers are pinned, because Effect rc versions are not compatible with each other', () => {
    // ⚠️ Measured: `>=4.0.0-rc.112` resolves to rc.115, where Config.string does not exist.
    for (const name of ['effect', '@effect/platform-node', 'alchemy']) {
      expect(pkg.peerDependencies[name]).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test('no peer is marked optional', () => {
    // ⛔ An optional peer should mean a FEATURE is absent without it. Every peer here is
    //   needed for its subpath to load at all — `cloudflare` was marked optional in 0.1.1
    //   and `/cloudflare` threw "Cannot find package" without it.
    expect(pkg.peerDependenciesMeta ?? {}).toEqual({});
  });

  test('the README tells consumers about the overrides block', () => {
    // Pinned peers are not enough: platform-node-shared resolves up transitively.
    expect(readme).toContain('overrides');
    expect(readme).toContain('@effect/platform-node-shared');
  });

  test('overrides pin rolldown to an exact tarball, not a floating tilde', () => {
    // 🔴 Measured 2026-09-16 on main CI after #39: `bun add` in the smoke scratch
    //   (no lockfile) installed alchemy's optional peer vite@^8, whose
    //   `rolldown: ~1.2.6` resolved to 1.2.9. The registry listed 1.2.9 and 404'd
    //   `rolldown-1.2.9.tgz` — #37 was green five minutes earlier on 1.2.8.
    // ⛔ A range here is the same defect: the next publish 404s the consumer install.
    expect(smoke).toMatch(/rolldown:\s*'1\.2\.8'/);
    expect(readme).toContain('"rolldown": "1.2.8"');
  });
});
