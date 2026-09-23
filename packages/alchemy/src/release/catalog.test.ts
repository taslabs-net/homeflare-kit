/**
 * A catalog request → pinned props, or a refusal — pure, over the REAL Victoria data set. Every
 * refusal here happens in the stack's own program, so it fails the plan before any resource runs
 * (plan.test.ts proves that through the engine).
 */
import { describe, expect, test } from 'bun:test';
import { binaryProblems } from './binary-form.ts';
import type { ReleaseCatalog } from './catalog.ts';
import { catalogBinary, catalogDirectory, catalogProblems, identifyBinary } from './catalog.ts';
import { OPENBAO_RELEASES } from './openbao.ts';
import { BinaryRefused } from './refused.ts';
import { VICTORIA_RELEASES } from './victoria.ts';

const VMALERT = {
  binary: 'vmalert',
  package: 'vmutils',
  platform: 'darwin-arm64',
  version: '1.151.0',
};

describe('refusing what the catalog does not pin', () => {
  test.each([
    [
      'a version the catalog does not pin',
      { version: '1.152.0' },
      'vmutils 1.152.0 is not in the catalog',
    ],
    ['the tag spelling', { version: 'v1.151.0' }, 'is not in the catalog'],
    ['an enterprise version', { version: '1.151.0-enterprise' }, 'is not in the catalog'],
    [
      'a cluster package',
      { package: 'victoria-metrics-cluster' },
      'package "victoria-metrics-cluster"',
    ],
    ['the vendor member name', { binary: 'vmalert-prod' }, 'that is the archive member'],
    ['a binary vmutils does not ship', { binary: 'vminsert' }, 'has no binary "vminsert"'],
    ['another platform', { platform: 'linux-amd64' }, 'not pinned for platform "linux-amd64"'],
    ['an inherited key', { package: 'constructor' }, 'package "constructor"'],
  ])('refuses %s', (_, change, message) => {
    const request = { ...VMALERT, ...change };
    expect(catalogProblems(VICTORIA_RELEASES, request).join('; ')).toContain(message);
    expect(() => catalogBinary(VICTORIA_RELEASES, request)).toThrow(message);
  });

  test('the refusal is typed, names the binary, and says nothing was fetched', () => {
    let caught: unknown;
    try {
      catalogBinary(VICTORIA_RELEASES, { ...VMALERT, version: '1.152.0' });
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(BinaryRefused);
    expect((caught as Error).message).toMatch(
      /^Release\.Binary vmalert: .* Nothing was fetched\.$/,
    );
  });
});

describe('what a pinned request becomes', () => {
  test('props that validate once the stack adds a directory', () => {
    const pinned = catalogBinary(VICTORIA_RELEASES, VMALERT);
    const directory = catalogDirectory('/opt/example/bin', VMALERT);
    expect(directory).toBe('/opt/example/bin/vmutils-1.151.0');
    expect(binaryProblems({ ...pinned, directory })).toEqual([]);
  });

  test('every binary of every pinned archive resolves to valid props', () => {
    for (const [pkg, entry] of Object.entries(VICTORIA_RELEASES.packages)) {
      for (const [version, platforms] of Object.entries(entry.versions)) {
        for (const platform of Object.keys(platforms)) {
          for (const binary of Object.keys(entry.binaries)) {
            const request = { binary, package: pkg, platform, version };
            const props = { ...catalogBinary(VICTORIA_RELEASES, request), directory: '/x/y' };
            expect(binaryProblems(props)).toEqual([]);
          }
        }
      }
    }
  });
});

describe('identifying an installed file', () => {
  test('by its digest alone', () => {
    const pin = '4759ec89a466129b9eefc22244a111e1f489739340747805fd93b58fd0f7b2dd';
    expect(identifyBinary([VICTORIA_RELEASES], pin)).toEqual({
      binary: 'victoria-traces',
      package: 'victoria-traces',
      platform: 'darwin-arm64',
      vendor: 'VictoriaMetrics',
      version: '0.10.0',
    });
  });

  test("an archive's digest is not a binary's: identity is by the member's own line", () => {
    const archive = 'cbe83f1d409cbb85fbf1c890c4a9b7fd34c1d74acec4dce2e0ebe46fcb260e38';
    expect(identifyBinary([VICTORIA_RELEASES], archive)).toBeUndefined();
  });

  test('by a COMPUTED digest, same as a vendor one — OpenBao pins bao only there', () => {
    const computed = 'd476d17e81a35e6d70dd7e86a8ab2a3664313525118f1f1cfe0130e7a2b95f3a';
    expect(identifyBinary([VICTORIA_RELEASES, OPENBAO_RELEASES], computed)).toEqual({
      binary: 'bao',
      package: 'openbao',
      platform: 'darwin_arm64',
      vendor: 'OpenBao',
      version: '2.6.2',
    });
  });
});

/** A fabricated one-entry catalog, only to exercise the `computed`/`members` overlap refusal. */
const doubled = (extra: {
  members?: Record<string, string>;
  computed?: Record<string, { sha256: string; recorded: string }>;
}): ReleaseCatalog => ({
  packages: {
    thing: {
      binaries: { thing: 'thing-bin' },
      versions: {
        '1.0.0': {
          any: {
            asset: 'thing-1.0.0.tar.gz',
            checksums: {
              recorded: '2026-09-23',
              sha256: 'a'.repeat(64),
              url: 'https://example.invalid/checksums.txt',
            },
            // ⚠️ Spread, not a plain key: `exactOptionalPropertyTypes` treats an explicit
            //   `computed: undefined` as different from the key being absent.
            ...(extra.computed !== undefined ? { computed: extra.computed } : {}),
            members: extra.members ?? {},
            repo: 'example/thing',
            sha256: 'b'.repeat(64),
            size: 1,
            tag: 'v1.0.0',
          },
        },
      },
    },
  },
  vendor: 'Example',
});

const THING = { binary: 'thing', package: 'thing', platform: 'any', version: '1.0.0' };

describe('a member pinned twice, once vendor and once computed', () => {
  test('catalogProblems names it, rather than silently preferring one', () => {
    const catalog = doubled({
      computed: { 'thing-bin': { recorded: '2026-09-23', sha256: 'c'.repeat(64) } },
      members: { 'thing-bin': 'c'.repeat(64) },
    });
    const problems = catalogProblems(catalog, THING);
    expect(problems.join('; ')).toContain('pinned twice');
    expect(() => catalogBinary(catalog, THING)).toThrow('pinned twice');
  });

  test('computed alone resolves; vendor alone resolves; neither refuses "no digest"', () => {
    const computedOnly = doubled({
      computed: { 'thing-bin': { recorded: '2026-09-23', sha256: 'c'.repeat(64) } },
    });
    expect(catalogBinary(computedOnly, THING).sha256).toBe('c'.repeat(64));
    const vendorOnly = doubled({ members: { 'thing-bin': 'd'.repeat(64) } });
    expect(catalogBinary(vendorOnly, THING).sha256).toBe('d'.repeat(64));
    const neither = doubled({});
    expect(() => catalogBinary(neither, THING)).toThrow('pins no digest');
  });
});
