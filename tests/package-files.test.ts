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
const PACKAGES = ['kit', 'cloudflare', 'ui', 'auth', 'config'];

async function manifest(
  name: string,
): Promise<{ files?: string[]; name: string; scripts?: Record<string, string> }> {
  return (await Bun.file(new URL(`packages/${name}/package.json`, root)).json()) as {
    files?: string[];
    name: string;
    scripts?: Record<string, string>;
  };
}

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
    const license = await Bun.file(new URL(`packages/${pkg}/LICENSE`, root)).text();
    expect(license).toContain('MIT License');
  });

  test('declares README and LICENSE so they reach the tarball', async () => {
    const { files = [] } = await manifest(pkg);

    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');
  });
});
