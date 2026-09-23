/**
 * The REAL Victoria data set against the vendor's own files — no network: fixtures/victoria/ holds
 * the four checksum files byte-for-byte as fetched on 2026-09-22 (each one's SHA-256 equalled
 * GitHub's asset digest for it that day; the data set records it), and the darwin-arm64 asset
 * names the release API listed.
 *
 * ★ THE CHAIN THIS PROVES: fixture bytes = the recorded digest of the vendor file → the parser
 *   reads exactly its lines → the data set equals those lines. A pin typed by hand, a member missed
 *   or a line the vendor added fails here, not on a host.
 * ⚠️ CONSISTENCY, NOT PROVENANCE. No network here: that the recorded digest is GITHUB'S was measured
 *   once, on the recorded date. A change that edits a fixture and its pins together passes; review
 *   is the gate for that.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import { releaseUrl } from './binary-form.ts';
import { catalogBinary } from './catalog.ts';
import { parseChecksums } from './checksums.ts';
import { VICTORIA_RELEASES } from './victoria.ts';

const fixture = (name: string) => Bun.file(new URL(`fixtures/victoria/${name}`, import.meta.url));
const assets = (await fixture('darwin-arm64-assets.txt').text()).trim().split('\n');
const REPOS: Readonly<Record<string, string>> = {
  'victoria-logs': 'VictoriaMetrics/VictoriaLogs',
  'victoria-metrics': 'VictoriaMetrics/VictoriaMetrics',
  'victoria-traces': 'VictoriaMetrics/VictoriaTraces',
  vmutils: 'VictoriaMetrics/VictoriaMetrics',
};

const archives = Object.entries(VICTORIA_RELEASES.packages).flatMap(([pkg, entry]) =>
  Object.entries(entry.versions).flatMap(([version, platforms]) =>
    Object.entries(platforms).map(([platform, archive]) => ({
      archive,
      entry,
      pkg,
      platform,
      version,
    })),
  ),
);

describe('the Victoria data set is the vendor checksum files', () => {
  test('it pins the four archives the Mac host runs, and nothing else', () => {
    expect(archives.map((a) => `${a.pkg} ${a.version} ${a.platform}`).sort()).toEqual([
      'victoria-logs 1.52.0 darwin-arm64',
      'victoria-metrics 1.151.0 darwin-arm64',
      'victoria-traces 0.10.0 darwin-arm64',
      'vmutils 1.151.0 darwin-arm64',
    ]);
  });

  test.each(archives.map((a) => [`${a.pkg} ${a.version}`, a] as const))('%s', async (_, a) => {
    const asset = `${a.pkg}-${a.platform}-v${a.version}.tar.gz`;
    const sums = `${a.pkg}-${a.platform}-v${a.version}_checksums.txt`;
    // ⛔ Exact, whole names — and the names the release API actually lists.
    expect([a.archive.repo, a.archive.tag, a.archive.asset]).toEqual([
      REPOS[a.pkg] ?? '',
      `v${a.version}`,
      asset,
    ]);
    const base = `https://github.com/${REPOS[a.pkg] ?? ''}/releases/download/v${a.version}`;
    expect(releaseUrl(a.archive.repo, a.archive.tag, a.archive.asset)).toBe(`${base}/${asset}`);
    expect(a.archive.checksums.url).toBe(`${base}/${sums}`);
    expect(a.archive.checksums.recorded).toBe('2026-09-22');
    expect(assets).toContain(asset);
    const bytes = new Uint8Array(await fixture(sums).arrayBuffer());
    expect(sha256Hex(bytes)).toBe(a.archive.checksums.sha256);
    const lines = parseChecksums(new TextDecoder().decode(bytes));
    const [first, ...members] = [...lines.entries()];
    expect(first).toEqual([asset, a.archive.sha256]);
    expect(Object.fromEntries(members)).toEqual(a.archive.members);
    // ★ Every installed name maps to `<name>-prod`, deliberately, and every one is pinned.
    for (const [binary, member] of Object.entries(a.entry.binaries)) {
      expect(member).toBe(`${binary}-prod`);
      expect(a.archive.members[member]).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(a.entry.binaries).length).toBe(members.length);
  });

  test('no pinned asset is an enterprise, cluster or other sibling, though each one is listed', () => {
    const siblings = assets.filter((name) => /-(enterprise|cluster)[._]/.test(name));
    expect(siblings.length).toBe(12);
    const names = archives.flatMap((a) => [a.archive.asset, a.archive.checksums.url]);
    for (const name of names) expect(name).not.toMatch(/enterprise|cluster|vlutils/);
    for (const sibling of siblings) expect(names.some((n) => n.endsWith(sibling))).toBe(false);
  });

  test('vmalert out of the data set: the member vmalert-prod of the plain vmutils archive', () => {
    const request = {
      binary: 'vmalert',
      package: 'vmutils',
      platform: 'darwin-arm64',
      version: '1.151.0',
    };
    expect(catalogBinary(VICTORIA_RELEASES, request)).toEqual({
      archive: {
        asset: 'vmutils-darwin-arm64-v1.151.0.tar.gz',
        repo: 'VictoriaMetrics/VictoriaMetrics',
        sha256: '27d68bac90e28929214091ed9d27f2e9fef25a080407e2c8661ea9b52dd6b183',
        size: 123_584_800,
        tag: 'v1.151.0',
      },
      member: 'vmalert-prod',
      name: 'vmalert',
      sha256: '62845795167e9ff47890e83ac4ac5934693c105767db88591c95a08f3c4fb354',
    });
  });
});
