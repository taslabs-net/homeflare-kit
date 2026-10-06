/**
 * The trust-boundary seam is excluded from every published artifact, pinned in BOTH places
 * that decide what ships. scripts/smoke.ts proves the tarball outcome by packing the real
 * tarball; this test pins the CONFIG that produces it, so a future edit that drops one of
 * the two exclusions fails here without a full build.
 *
 * The gap this pins: the seam (talos/trust-boundary.seam.ts) is the only module that can
 * register a directory the talosctl ancestor walk may stop above. It is excluded from the
 * files list as source, but the declaration build emitted dist/talos/trust-boundary.seam.d.ts
 * because tsconfig.build.json included all of src and tsc re-includes an excluded file that an
 * included file imports - the seam's static importer fake-process.ts and its fixture importers
 * (all test-only, none on the talos/index.ts barrel) had to be excluded too. The tarball ships
 * dist, so the seam's .d.ts leaked past the source exclusion and scripts/smoke.ts:103 failed
 * the release.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
  files: string[];
};
// JSONC (comments), so Bun.file().json() cannot parse it; assert on the text instead.
const buildConfig = await Bun.file(new URL('tsconfig.build.json', root)).text();

describe('the trust-boundary seam is excluded from every published artifact', () => {
  test('package.json files excludes the seam as source AND as emitted declaration', () => {
    expect(pkg.files).toContain('!src/**/trust-boundary.seam.ts');
    expect(pkg.files).toContain('!dist/**/trust-boundary.seam.*');
  });

  test('the declaration build excludes the seam and its import chain, so no .d.ts is emitted', () => {
    // tsc re-includes an excluded file that an included file imports: fake-process.ts
    // statically imports the seam, so excluding the seam alone still emits its .d.ts. Each
    // member of that test-only chain must be excluded or the release leaks the seam's types.
    for (const entry of [
      '**/talos/trust-boundary.seam.ts',
      '**/talos/fake-process.ts',
      '**/talos/cluster-adapter.fixtures.ts',
      '**/talos/kubeconfig.fixtures.ts',
      '**/talos/machine-config-fixtures.ts',
      '**/talos/node-connect.harness.ts',
    ]) {
      expect(buildConfig).toContain(entry);
    }
  });
});
