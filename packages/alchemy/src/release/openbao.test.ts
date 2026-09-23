/**
 * The REAL OpenBao data set against the vendor's own files — no network: fixtures/openbao/ holds
 * checksums.txt, its detached GPG signature and the signing key byte-for-byte as fetched
 * 2026-09-23 (each one's SHA-256 equals GitHub's / openbao.org's digest for it that day).
 *
 * ★ THE CHAIN THIS PROVES: fixture bytes = the recorded digest → the strict parser reads exactly
 *   its 83 lines → none of them names `bao` → the pin is filed under `computed`, never `members`.
 *   The GPG check is NOT re-run here (gpgv needs a binary this repo does not vendor); it is a
 *   recorded one-time measurement (docs/release-binary-openbao.md), same status as Victoria's
 *   "consistency, not provenance" note.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import { releaseUrl } from './binary-form.ts';
import { catalogBinary } from './catalog.ts';
import { parseChecksums } from './checksums.ts';
import { OPENBAO_RELEASES } from './openbao.ts';

const fixture = (name: string) => Bun.file(new URL(`fixtures/openbao/${name}`, import.meta.url));
const PLATFORM = 'darwin_arm64';
const archive = OPENBAO_RELEASES.packages.openbao?.versions['2.6.2']?.[PLATFORM];
if (archive === undefined)
  throw new Error('fixture setup: OPENBAO_RELEASES has no darwin_arm64 pin');

describe('the OpenBao data set is the vendor checksum file', () => {
  test('one package, one version, one platform', () => {
    expect(Object.keys(OPENBAO_RELEASES.packages)).toEqual(['openbao']);
    expect(Object.keys(OPENBAO_RELEASES.packages.openbao?.versions ?? {})).toEqual(['2.6.2']);
    expect(Object.keys(OPENBAO_RELEASES.packages.openbao?.versions['2.6.2'] ?? {})).toEqual([
      PLATFORM,
    ]);
  });

  test('archive pin: repo, tag, asset, URL', () => {
    expect([archive.repo, archive.tag, archive.asset]).toEqual([
      'openbao/openbao',
      'v2.6.2',
      'openbao_2.6.2_darwin_arm64.tar.gz',
    ]);
    expect(releaseUrl(archive.repo, archive.tag, archive.asset)).toBe(
      `https://github.com/openbao/openbao/releases/download/v2.6.2/openbao_2.6.2_darwin_arm64.tar.gz`,
    );
  });

  test('checksums.txt: 83 lines, byte-identical to the recorded digest, archive line equals the pin', async () => {
    const bytes = new Uint8Array(await fixture('checksums.txt').arrayBuffer());
    expect(sha256Hex(bytes)).toBe(archive.checksums.sha256);
    expect(archive.checksums.url).toBe(
      'https://github.com/openbao/openbao/releases/download/v2.6.2/checksums.txt',
    );
    const lines = parseChecksums(new TextDecoder().decode(bytes));
    expect(lines.size).toBe(83);
    expect(lines.get(archive.asset)).toBe(archive.sha256);
  });

  test('no line names the `bao` member — it is not a vendor fact', async () => {
    const bytes = new Uint8Array(await fixture('checksums.txt').arrayBuffer());
    const lines = parseChecksums(new TextDecoder().decode(bytes));
    expect(lines.has('bao')).toBe(false);
    expect(archive.members).toEqual({});
  });

  test('the member digest is filed under `computed`, dated, not under `members`', () => {
    expect(archive.computed?.bao).toEqual({
      recorded: '2026-09-23',
      sha256: 'd476d17e81a35e6d70dd7e86a8ab2a3664313525118f1f1cfe0130e7a2b95f3a',
    });
  });

  test('the checksums file is GPG-signed, and the signature and key are pinned', async () => {
    const sigBytes = new Uint8Array(await fixture('checksums.txt.gpgsig').arrayBuffer());
    const keyBytes = new Uint8Array(await fixture('openbao-gpg-pub-20240618.asc').arrayBuffer());
    const sig = archive.checksums.signature;
    if (sig === undefined) throw new Error('fixture setup: no checksums.signature pinned');
    expect(sig.kind).toBe('openpgp');
    expect(sha256Hex(sigBytes)).toBe(sig.sha256);
    expect(sha256Hex(keyBytes)).toBe(sig.key.sha256);
    expect(sig.key.fingerprint).toBe('66D15FDD87287219C8E15478D200CD702853E6D0');
  });

  test('the asset is in the committed darwin listing, and no sibling is pinned', async () => {
    const assets = (await fixture('darwin-assets.txt').text()).trim().split('\n');
    expect(assets).toContain(archive.asset);
    // ★ Every OTHER darwin asset (the amd64 archive, and every .sbom.json / .gpgsig / .sigstore.json
    //   next to both) is listed here so a reviewer can see what was excluded, but pinned nowhere.
    const siblings = assets.filter((name) => name !== archive.asset);
    expect(siblings).toEqual([
      'openbao_2.6.2_darwin_amd64.tar.gz',
      'openbao_2.6.2_darwin_amd64.tar.gz.gpgsig',
      'openbao_2.6.2_darwin_amd64.tar.gz.sbom.json',
      'openbao_2.6.2_darwin_amd64.tar.gz.sbom.json.gpgsig',
      'openbao_2.6.2_darwin_amd64.tar.gz.sbom.json.sigstore.json',
      'openbao_2.6.2_darwin_amd64.tar.gz.sigstore.json',
      'openbao_2.6.2_darwin_arm64.tar.gz.gpgsig',
      'openbao_2.6.2_darwin_arm64.tar.gz.sbom.json',
      'openbao_2.6.2_darwin_arm64.tar.gz.sbom.json.gpgsig',
      'openbao_2.6.2_darwin_arm64.tar.gz.sbom.json.sigstore.json',
      'openbao_2.6.2_darwin_arm64.tar.gz.sigstore.json',
    ]);
    expect(siblings.some((name) => name.startsWith('openbao-hsm_'))).toBe(false);
    const pinnedPlatforms = Object.keys(OPENBAO_RELEASES.packages.openbao?.versions['2.6.2'] ?? {});
    expect(pinnedPlatforms).not.toContain('darwin_amd64');
  });

  test('bao out of the data set: the computed member of the one pinned archive', () => {
    const request = { binary: 'bao', package: 'openbao', platform: PLATFORM, version: '2.6.2' };
    expect(catalogBinary(OPENBAO_RELEASES, request)).toEqual({
      archive: {
        asset: 'openbao_2.6.2_darwin_arm64.tar.gz',
        repo: 'openbao/openbao',
        sha256: '4e495376174accc0e014d31e9901f518a974f966850c839f626347eaac05fd52',
        size: 76_833_570,
        tag: 'v2.6.2',
      },
      member: 'bao',
      name: 'bao',
      sha256: 'd476d17e81a35e6d70dd7e86a8ab2a3664313525118f1f1cfe0130e7a2b95f3a',
    });
  });
});
