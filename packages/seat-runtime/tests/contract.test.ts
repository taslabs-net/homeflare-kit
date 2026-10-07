/**
 * The published contract, asserted where it is written down.
 *
 * 🔴 WHY (from @homeflare/alchemy's peers.test.ts). 0.1.1 of that package shipped because the
 *   README's install line and the smoke test's install line DISAGREED and nothing compared
 *   them. Same comparison here, plus: every export is documented.
 */
import { describe, expect, test } from 'bun:test';
import * as main from '../src/index.ts';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  version: string;
  files: string[];
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
};
const readme = await Bun.file(new URL('README.md', root)).text();
const smoke = await Bun.file(new URL('scripts/smoke.ts', root)).text();

describe('install contract', () => {
  test('the peer is pinned exactly, because effect rc versions break each other', () => {
    expect(pkg.peerDependencies['effect']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the README install line, its overrides and the smoke install carry one pin', () => {
    const rc = pkg.peerDependencies['effect'] ?? '';
    expect(readme).toContain(`effect@${rc}`);
    expect(readme).toContain(`"@effect/platform-node-shared": "${rc}"`);
    expect(readme).toContain(`"effect": "${rc}"`);
    expect(smoke).toContain(`const RC = '${rc}'`);
    expect(smoke).toContain('@effect/platform-node-shared');
  });

  test('no peer is optional', () => {
    expect(pkg.peerDependenciesMeta ?? {}).toEqual({});
  });

  test('the README and LICENSE ship', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'README.md', 'LICENSE']));
  });
});

describe('runtime-neutral source', () => {
  test('nothing under src/ imports bun:* or node:*', async () => {
    // ⛔ It rides `fetch` so it runs on workerd; a `node:` import resolves on a laptop and
    //   fails only where the bundler names the wrong file (AGENTS.md, "runtime-neutral").
    let scanned = 0;
    for await (const path of new Bun.Glob('src/**/*.ts').scan({ cwd: root.pathname })) {
      scanned += 1;
      const text = await Bun.file(new URL(path, root)).text();
      expect(text, path).not.toMatch(/from\s+['"](bun|node):/);
    }
    expect(scanned).toBeGreaterThanOrEqual(5);
  });
});

describe('docs cover the surface', () => {
  test('every runtime export of the entrypoint, and of each namespace, is named in the README', () => {
    const names = [
      ...Object.keys(main),
      ...Object.keys(main.SeatModel),
      ...Object.keys(main.SeatObs),
    ];
    expect(names).toEqual(
      expect.arrayContaining(['SeatModel', 'SeatObs', 'VERSION', 'layer', 'embeddingLayer']),
    );
    for (const name of names) expect(readme).toContain(name);
  });

  test('the README states the three CT100 endpoints exactly as the code pins them', () => {
    for (const url of Object.values(main.SeatObs.CT100_ENDPOINTS)) expect(readme).toContain(url);
  });

  test('VERSION is the package version', () => {
    expect(main.VERSION).toBe(pkg.version);
  });
});
