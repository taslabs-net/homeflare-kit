/**
 * Guards `@homeflare/config/versions` against the kit's own catalog.
 *
 * ★ THE CATALOG IS THE SOURCE, AND THE EXPORT IS ITS PUBLISHED COPY. A copy that is not
 *   compared with its source is a second source, and that is exactly the problem the export
 *   was written to remove. So every value is checked here, in the PR that changes either one.
 *
 * ⛔ THE DISTILLED PIN IS CHECKED AGAINST ALCHEMY ITSELF, NOT ONLY AGAINST THE KIT. The version
 *   that matters is the one the pinned `alchemy` release was built and tested against. The
 *   installed `alchemy/package.json` states it in `dependencies`, so a bump of `alchemy` that
 *   leaves the distilled pin behind fails here, before any consumer sees a skew.
 */
import { describe, expect, test } from 'bun:test';
import { BUN_VERSION } from '../packages/config/src/repo-shape/ci.ts';
import { ESTATE_VERSIONS, type EstatePackage } from '../packages/config/src/versions.ts';

type Manifest = {
  readonly packageManager?: string;
  readonly catalog?: Record<string, string>;
  readonly overrides?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

const root = new URL('../', import.meta.url);
const read = async (path: string): Promise<Manifest> =>
  (await Bun.file(new URL(path, root)).json()) as Manifest;
const rootPkg = await read('package.json');
const catalog = rootPkg.catalog ?? {};

describe('@homeflare/config/versions', () => {
  test('bun matches the rendered CI pin and the root packageManager', () => {
    expect(ESTATE_VERSIONS.bun).toBe(BUN_VERSION);
    expect(rootPkg.packageManager).toBe(`bun@${ESTATE_VERSIONS.bun}`);
  });

  test('every catalogued entry equals the kit catalog', () => {
    const catalogued: EstatePackage[] = [
      'alchemy',
      'effect',
      'typescript',
      'oxfmt',
      'oxlint',
      '@types/bun',
    ];
    for (const name of catalogued) {
      // ★ The name rides along in the compared string, so a failure says WHICH pin drifted.
      expect(`${name}@${ESTATE_VERSIONS[name]}`).toBe(`${name}@${catalog[name] ?? 'missing'}`);
    }
  });

  test('effect equals the root override the whole workspace resolves', () => {
    expect(rootPkg.overrides?.['effect']).toBe(ESTATE_VERSIONS.effect);
  });

  test('the distilled pin is the one the pinned alchemy release depends on', async () => {
    const alchemy = await read('node_modules/alchemy/package.json');
    const provider = await read('packages/alchemy/package.json');
    const name = '@distilled.cloud/cloudflare';
    expect(alchemy.dependencies?.[name]).toBe(ESTATE_VERSIONS[name]);
    expect(provider.devDependencies?.[name]).toBe(ESTATE_VERSIONS[name]);
  });

  test('every value is an exact version, never a range', () => {
    for (const version of Object.values(ESTATE_VERSIONS)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    }
  });
});
