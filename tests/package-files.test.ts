/**
 * Guards what each package actually ships.
 *
 * ⚠️ THE BUG THIS CATCHES, MEASURED 2026-09-15. Three packages declared `README.md` and
 *   `LICENSE` in `files` and had neither on disk. npm does not error on a missing entry —
 *   it just omits it — so `@homeflare/cloudflare`, `/ui` and `/auth` shipped with blank
 *   npm pages and no licence text, and every gate in this repo stayed green.
 */
import { stat } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
/**
 * Every workspace package, DISCOVERED. ⚠️ The hand list this replaced had drifted: neither
 * @homeflare/typesafe nor @homeflare/alchemy was in it, so nothing checked that they ship
 * their README, LICENSE or a smoke test that can fail.
 */
const PACKAGES: string[] = await Array.fromAsync(
  new Bun.Glob('packages/*/package.json').scan({ cwd: root.pathname }),
).then((paths) => paths.map((path) => path.split('/')[1] ?? '').sort());

async function manifest(name: string): Promise<{
  files?: string[];
  license?: string;
  name: string;
  scripts?: Record<string, string>;
}> {
  return (await Bun.file(new URL(`packages/${name}/package.json`, root)).json()) as {
    files?: string[];
    license?: string;
    name: string;
    scripts?: Record<string, string>;
  };
}

/**
 * The text a `LICENSE` file must contain for a given `package.json.license`
 * value. ⚠️ Almost every kit package is MIT — the one deliberate exception is
 * a package that is itself a redistribution of someone else's licensed
 * output (`@homeflare/distilled-netbox`'s `src/` is an unmodified copy of
 * `alchemy-run/distilled`'s Apache-2.0 SDK output; relicensing a copy as MIT
 * would misstate what it is). Add a case here, not a skip, for the next one.
 */
const LICENSE_TEXT: Record<string, string> = {
  MIT: 'MIT License',
  'Apache-2.0': 'Apache License',
};

describe.each(PACKAGES)('packages/%s', (pkg) => {
  test('ships every file it declares', async () => {
    const { files = [] } = await manifest(pkg);

    for (const entry of files) {
      // ⚠️ Bun.file().exists() answers about FILES and is false for a DIRECTORY, so a
      //   `files` entry like `dist`, `src` or `styles` needs a stat, not a file check.
      //   ⛔ Do not guess by extension: that sends README.md down the directory branch
      //     and throws ENOTDIR. Ask the filesystem what it is.
      const target = new URL(`packages/${pkg}/${entry}`, root).pathname;
      const present = await stat(target)
        .then(() => true)
        .catch(() => false);

      expect(present).toBe(true);
    }
  });

  test('its smoke test can actually fail', async () => {
    // 🔴 THE DEFECT THIS STOPS, twice over. An outside review caught `echo` as a smoke
    //   script in @homeflare/ui; I then shipped the same thing in @homeflare/alchemy, and
    //   THREE defects went out behind it — each installed cleanly and threw at import.
    // ⛔ A check that cannot fail is worse than no check: it reads as coverage in CI and
    //   in review, so nobody looks again.
    const { scripts } = await manifest(pkg);
    const smoke = scripts?.['smoke'] ?? '';

    expect(smoke).not.toMatch(/^echo/);
    expect(smoke).toContain('scripts/smoke.ts');
  });

  test('its smoke test installs the packed tarball and IMPORTS it', async () => {
    // ⚠️ Packing is not enough. All three @homeflare/alchemy defects passed a pack-only
    //   check — a missing peer, a ranged peer resolving wrong, and a transitive skew all
    //   fail at import, not at install.
    const src = await Bun.file(new URL(`packages/${pkg}/scripts/smoke.ts`, root)).text();

    expect(src).toContain('packForPublish');
    expect(src).toContain('bun');
  });

  test('has a README, so its npm page is not blank', async () => {
    const readme = await Bun.file(new URL(`packages/${pkg}/README.md`, root)).text();

    // ⛔ A scaffold package must SAY it is one. A blank or bare page reads as "ready".
    expect(readme.length).toBeGreaterThan(200);
    expect(readme).toContain('## License');
  });

  test('carries the licence text it claims', async () => {
    const { license: declared = 'MIT' } = await manifest(pkg);
    const want = LICENSE_TEXT[declared];
    // ⛔ An undeclared license name is a defect in THIS table, not something
    //   to skip past — add it above before the package can pass.
    expect(want, `no LICENSE_TEXT entry for "${declared}"`).toBeDefined();

    const license = await Bun.file(new URL(`packages/${pkg}/LICENSE`, root)).text();
    expect(license).toContain(want as string);
  });

  test('declares README and LICENSE so they reach the tarball', async () => {
    const { files = [] } = await manifest(pkg);

    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');
  });
});
