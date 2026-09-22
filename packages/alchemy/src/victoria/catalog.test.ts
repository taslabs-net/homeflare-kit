/**
 * The REAL catalog against the vendor's own files — no network: fixtures/ holds the four checksum
 * files byte-for-byte as fetched on 2026-09-22 (each one's SHA-256 equals GitHub's asset digest for
 * it, which the catalog also records), and the darwin-arm64 asset names the release API listed.
 *
 * ★ THE CHAIN THIS PROVES: fixture bytes = the vendor file (its GitHub digest) → the parser reads
 *   exactly its lines → the catalog equals those lines. A pin typed by hand, a member missed or a
 *   line the vendor added fails here, not on a host.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import { VICTORIA_CATALOG, type VictoriaPackage } from './catalog.ts';
import { parseChecksums } from './checksums.ts';
import { identifyVictoriaBinary, releaseProblems, resolveVictoriaRelease } from './release.ts';

const fixture = (name: string) => Bun.file(new URL(`fixtures/${name}`, import.meta.url));
const assets = (await fixture('darwin-arm64-assets.txt').text()).trim().split('\n');
const REPOS: Record<VictoriaPackage, string> = {
  'victoria-logs': 'VictoriaLogs',
  'victoria-metrics': 'VictoriaMetrics',
  'victoria-traces': 'VictoriaTraces',
  vmutils: 'VictoriaMetrics',
};

const archives = Object.entries(VICTORIA_CATALOG).flatMap(([pkg, entry]) =>
  Object.entries(entry.versions).flatMap(([version, platforms]) =>
    Object.entries(platforms).map(([platform, archive]) => ({
      archive,
      entry,
      pkg: pkg as VictoriaPackage,
      platform,
      version,
    })),
  ),
);

describe('the catalog is the vendor checksum files', () => {
  test.each(archives.map((a) => [`${a.pkg} ${a.version}`, a] as const))('%s', async (_, a) => {
    const asset = `${a.pkg}-${a.platform}-v${a.version}.tar.gz`;
    const sums = `${a.pkg}-${a.platform}-v${a.version}_checksums.txt`;
    const base = `https://github.com/VictoriaMetrics/${REPOS[a.pkg]}/releases/download/v${a.version}`;
    // ⛔ Exact, whole URLs — and the names the release API actually lists.
    expect(a.archive.url).toBe(`${base}/${asset}`);
    expect(a.archive.checksums.url).toBe(`${base}/${sums}`);
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

  test('no catalog URL is an enterprise, cluster or other sibling, though each one is listed', () => {
    const siblings = assets.filter((name) => /-(enterprise|cluster)[._]/.test(name));
    expect(siblings.length).toBe(12);
    const urls = archives.flatMap((a) => [a.archive.url, a.archive.checksums.url]);
    for (const url of urls) expect(url).not.toMatch(/enterprise|cluster|vlutils/);
    for (const sibling of siblings)
      expect(urls.some((url) => url.endsWith(`/${sibling}`))).toBe(false);
  });
});

describe('resolving a declaration', () => {
  const vmalert = {
    binary: 'vmalert',
    package: 'vmutils',
    platform: 'darwin-arm64',
    version: '1.151.0',
  };

  test('vmalert means member vmalert-prod of the plain vmutils archive', () => {
    expect(resolveVictoriaRelease(vmalert)).toMatchObject({
      member: 'vmalert-prod',
      memberSha256: '62845795167e9ff47890e83ac4ac5934693c105767db88591c95a08f3c4fb354',
      size: 123_584_800,
      url: 'https://github.com/VictoriaMetrics/VictoriaMetrics/releases/download/v1.151.0/vmutils-darwin-arm64-v1.151.0.tar.gz',
    });
  });

  test.each([
    ['a version the catalog does not pin', { version: '1.152.0' }, 'is not in the catalog'],
    ['the tag spelling', { version: 'v1.151.0' }, 'is not in the catalog'],
    ['an enterprise version', { version: '1.151.0-enterprise' }, 'is not in the catalog'],
    [
      'a cluster package',
      { package: 'victoria-metrics-cluster' },
      'package "victoria-metrics-cluster"',
    ],
    ['the vendor member name', { binary: 'vmalert-prod' }, 'without -prod'],
    ['a binary vmutils does not ship', { binary: 'vminsert' }, 'has no binary "vminsert"'],
    ['another platform', { platform: 'linux-amd64' }, 'not pinned for platform "linux-amd64"'],
  ])('refuses %s', (_, change, message) => {
    const problems = releaseProblems({ ...vmalert, ...change });
    expect(problems.join('; ')).toContain(message);
    expect(() => resolveVictoriaRelease({ ...vmalert, ...change })).toThrow(message);
  });

  test('an installed file is identified by its digest alone', () => {
    const pin = '4759ec89a466129b9eefc22244a111e1f489739340747805fd93b58fd0f7b2dd';
    expect(identifyVictoriaBinary(pin)).toEqual({
      binary: 'victoria-traces',
      package: 'victoria-traces',
      platform: 'darwin-arm64',
      version: '0.10.0',
    });
    // An archive's digest is not a binary's: identity is by the member's own line.
    expect(
      identifyVictoriaBinary('cbe83f1d409cbb85fbf1c890c4a9b7fd34c1d74acec4dce2e0ebe46fcb260e38'),
    ).toBeUndefined();
  });
});

describe('parseChecksums is strict', () => {
  const line = `${'a'.repeat(64)}  vmagent-prod`;
  test.each([
    ['CRLF endings', `${line}\r\n`],
    ['a binary-mode marker', `${'a'.repeat(64)} *vmagent-prod\n`],
    ['upper-case hex', `${'A'.repeat(64)}  vmagent-prod\n`],
    ['a blank line', `${line}\n\n`],
    ['no trailing newline', line],
    ['a name listed twice', `${line}\n${line}\n`],
    ['a path in a name', `${'a'.repeat(64)}  bin/vmagent-prod\n`],
  ])('refuses %s', (_, text) => {
    expect(() => parseChecksums(text)).toThrow();
  });
});
