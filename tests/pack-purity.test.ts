/**
 * 🔴 THE BUG THIS EXISTS FOR, measured 2026-09-16 and committed before it was noticed.
 *
 * `packForPublish` used to strip `scripts` and `devDependencies` FROM THE REAL manifest,
 * pack, then restore it in a `finally`. That is correct for one caller and destructive for
 * two: `bun run --filter '*' smoke` runs every package's smoke test IN PARALLEL, and both
 * @homeflare/auth and @homeflare/cloudflare pack @homeflare/kit as a workspace dependency.
 *
 * Both read the manifest, both stripped it, and the second restored the ALREADY-STRIPPED
 * copy it had read. @homeflare/kit's entire `scripts` block vanished from the working tree
 * — AFTER `verify` had already passed, so every gate was green and the damage was staged
 * and committed. It took four restore attempts to notice the tooling was doing it.
 *
 * ⛔ SO: packing must be PURE. It never writes inside the repository.
 */
import { describe, expect, test } from 'bun:test';
import { packForPublish } from '../scripts/pack.ts';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Every workspace manifest, as bytes, so any mutation shows up. */
async function manifestBytes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const path of new Bun.Glob('packages/*/package.json').scan({ cwd: REPO })) {
    out[path] = await Bun.file(`${REPO}/${path}`).text();
  }
  return out;
}

describe('packForPublish is pure', () => {
  test('packing the same package CONCURRENTLY leaves every manifest untouched', async () => {
    // ⛔ Two packs of ONE package at once — the exact shape that destroyed kit's scripts.
    const before = await manifestBytes();
    const scratch = `${(await Bun.file('/dev/null').exists()) ? '/tmp' : '/tmp'}/hf-pack-purity-${Bun.randomUUIDv7()}`;
    await Bun.spawn(['mkdir', '-p', scratch]).exited;

    try {
      const tarballs = await Promise.all([
        packForPublish(`${REPO}/packages/kit`, scratch),
        packForPublish(`${REPO}/packages/kit`, scratch),
      ]);

      for (const tarball of tarballs) expect(await Bun.file(tarball).exists()).toBe(true);
      // ⛔ bun pm pack names the file `{name}-{version}.tgz`. Two calls into the same
      //   destination therefore share one path, and stripScripts extracts a half-written
      //   gzip — `unexpected end of file` on Linux CI, measured 2026-09-16 (PR #40).
      //   Distinct paths are the proof each call owns its file.
      expect(tarballs[0]).not.toBe(tarballs[1]);
      expect(await manifestBytes()).toEqual(before);
    } finally {
      await Bun.spawn(['rm', '-rf', scratch]).exited;
    }
  }, 60_000);

  test('the packed tarball still has scripts and devDependencies stripped', async () => {
    // ⚠️ Purity must not have cost the stripping — a published manifest with a
    //   `prepublishOnly` would run a build in the CONSUMER's install.
    const scratch = `/tmp/hf-pack-strip-${Bun.randomUUIDv7()}`;
    await Bun.spawn(['mkdir', '-p', scratch]).exited;

    try {
      const tarball = await packForPublish(`${REPO}/packages/kit`, scratch);
      const proc = Bun.spawn(['tar', '-xzOf', tarball, 'package/package.json'], { stdout: 'pipe' });
      const packed = JSON.parse(await new Response(proc.stdout).text()) as Record<string, unknown>;

      expect(packed['scripts']).toBeUndefined();
      expect(packed['devDependencies']).toBeUndefined();
      expect(packed['name']).toBe('@homeflare/kit');
      // ⛔ And the parts a consumer installs must survive the staging copy.
      expect(packed['exports']).toBeDefined();
      expect(packed['dependencies']).toBeDefined();
    } finally {
      await Bun.spawn(['rm', '-rf', scratch]).exited;
    }
  }, 60_000);
});
