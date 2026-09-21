/**
 * The published contract, asserted where it is written down.
 *
 * 🔴 WHY (from @homeflare/alchemy's peers.test.ts). 0.1.1 of that package shipped because
 *   the README's install line and the smoke test's install line DISAGREED and nothing
 *   compared them. Same comparison here, plus: every export is documented.
 */
import { describe, expect, test } from 'bun:test';
import * as main from '../src/index.ts';
import * as load from '../src/load.ts';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  files: string[];
};
const readme = await Bun.file(new URL('README.md', root)).text();
const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();

describe('peer contract', () => {
  test('effect is the only peer, and there are no runtime dependencies', () => {
    expect(Object.keys(pkg.peerDependencies)).toEqual(['effect']);
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  test('the peer is pinned exactly, because effect rc versions break each other', () => {
    // ⚠️ Measured 2026-09-16 (alchemy): `>=4.0.0-rc.112` resolved to rc.115 and
    //   Config.string vanished. This package leans on Config/ConfigProvider internals
    //   whose override behaviour is itself measured per version (tests/overrides.test.ts).
    expect(pkg.peerDependencies['effect']).toMatch(/^\d+\.\d+\.\d+-rc\.\d+$/);
  });

  test('the README install line and the smoke install carry the same pin', () => {
    const pin = `effect@${pkg.peerDependencies['effect']}`;
    expect(readme).toContain(pin);
    expect(smoke).toContain(pin);
  });

  test('no peer is optional', () => {
    expect(pkg.peerDependenciesMeta ?? {}).toEqual({});
  });
});

describe('docs cover the surface', () => {
  test('every runtime export of both entrypoints is named in the README', () => {
    for (const name of [...Object.keys(main), ...Object.keys(load)]) {
      expect(readme).toContain(name);
    }
  });

  test('the example ships in the tarball', () => {
    expect(pkg.files).toContain('site.example.json');
    expect(readme).toContain(load.SITE_EXAMPLE);
  });
});
