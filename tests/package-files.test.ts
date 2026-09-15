/**
 * Guards what each package actually ships.
 *
 * ⚠️ THE BUG THIS CATCHES, MEASURED 2026-09-15. Three packages declared `README.md` and
 *   `LICENSE` in `files` and had neither on disk. npm does not error on a missing entry —
 *   it just omits it — so `@homeflare/cloudflare`, `/ui` and `/auth` shipped with blank
 *   npm pages and no licence text, and every gate in this repo stayed green.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const PACKAGES = ['kit', 'cloudflare', 'ui', 'auth', 'config'];

async function manifest(name: string): Promise<{ files?: string[]; name: string }> {
  return (await Bun.file(new URL(`packages/${name}/package.json`, root)).json()) as {
    files?: string[];
    name: string;
  };
}

describe.each(PACKAGES)('packages/%s', (pkg) => {
  test('ships every file it declares', async () => {
    const { files = [] } = await manifest(pkg);

    for (const entry of files) {
      // ⚠️ `dist` and `src` are DIRECTORIES, and Bun.file().exists() is false for one —
      //   it answers about files. They are covered by the build and the smoke test.
      if (entry === 'dist' || entry === 'src') continue;

      const exists = await Bun.file(new URL(`packages/${pkg}/${entry}`, root)).exists();
      expect(exists).toBe(true);
    }
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
