/**
 * The peer contract, asserted in three places at once.
 *
 * 🔴 WHY. @homeflare/alchemy 0.1.1 shipped because the README's install command and the
 *   smoke test's install command DISAGREED — the smoke test installed a peer the README
 *   omitted, so the gate proved an install no consumer would perform.
 * ⛔ A peer the manifest declares must appear in the README and in the smoke install.
 *
 * Also asserts the community adapter is gone: AnyAuth blocked on it, and a leftover
 * dependency would put it back in the tarball.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await Bun.file(new URL('package.json', root)).text()) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const readme = await Bun.file(new URL('README.md', root)).text();
const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();
const source = await Bun.file(new URL('src/storage.ts', root)).text();

describe('peer contract', () => {
  test('every peer appears in the README install', () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(readme).toContain(name);
    }
  });

  test('every peer is installed by the smoke test', () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(smoke).toContain(name);
    }
  });

  test('no peer is marked optional', () => {
    expect(pkg.peerDependenciesMeta ?? {}).toEqual({});
  });

  test('does not depend on better-auth-cloudflare', () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty('better-auth-cloudflare');
    expect(pkg.peerDependencies).not.toHaveProperty('better-auth-cloudflare');
    // Comments may name the package they forbid; an import would put it in the bundle.
    expect(source).not.toMatch(/from ['"]better-auth-cloudflare['"]/);
  });

  test('does not import better-auth — the consumer owns that call', () => {
    // ⛔ Importing better-auth here would make this package a factory, or at least pull
    //   the library into a consumer that only wanted storage. The adapter is the peer.
    expect(source).not.toMatch(/from ['"]better-auth/);
  });
});
