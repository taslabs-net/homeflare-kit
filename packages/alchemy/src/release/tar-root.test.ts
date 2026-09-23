/**
 * `tarReader(wanted, root)` — the declared-root mode measured against the Prometheus-family shape
 * (tar.ts's header comment, 2026-09-23): one directory entry wraps every other entry, stripped
 * before a name is matched, listed or checked for a duplicate. Everything tar.test.ts already
 * refuses keeps refusing; this file is only what `root` adds or changes.
 */
import { describe, expect, test } from 'bun:test';
import { bytesOf, tarOf } from './fake-release.ts';
import { ArchiveRefused } from './refused.ts';
import { tarReader } from './tar.ts';

const ROOT = 'alertmanager-0.33.1.darwin-arm64';
const wrapper = { name: `${ROOT}/`, type: '5' } as const;
const binary = { bytes: bytesOf('#!binary\n'), name: `${ROOT}/alertmanager` } as const;

const read = (tar: Uint8Array, wanted: readonly string[], root?: string) => {
  const reader = tarReader(new Set(wanted), root);
  reader.push(tar);
  return reader.finish();
};

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (cause) {
    expect(cause).toBeInstanceOf(ArchiveRefused);
    return (cause as ArchiveRefused).message;
  }
  throw new Error('expected a refusal');
};

describe('a declared root strips exactly one leading directory', () => {
  test('the member comes back under its stripped name; the root entry is not one of the names', () => {
    const tar = tarOf([wrapper, binary]);
    const { members, names } = read(tar, ['alertmanager'], ROOT);
    expect(new TextDecoder().decode(members.get('alertmanager'))).toBe('#!binary\n');
    expect(names).toEqual(['alertmanager']);
  });

  test('a sibling regular file under root is listed, stripped, but not fetched unless asked for', () => {
    const notice = { bytes: bytesOf('legal text'), name: `${ROOT}/NOTICE` };
    const { members, names } = read(tarOf([wrapper, binary, notice]), ['alertmanager'], ROOT);
    expect(names).toEqual(['alertmanager', 'NOTICE']);
    expect(members.has('NOTICE')).toBe(false);
  });

  test('THE SAME ARCHIVE, root omitted: still refused "is a directory" — origin/main\'s behaviour', () => {
    const tar = tarOf([wrapper, binary]);
    expect(refusal(() => read(tar, ['alertmanager']))).toContain('is a directory');
  });

  test('a root declared but never present in the archive is refused', () => {
    expect(refusal(() => read(tarOf([binary]), ['alertmanager'], ROOT))).toContain('never appears');
  });
});

describe('everything a declared root still refuses, whole archive', () => {
  test.each([
    [
      'a second directory entry (the root, twice)',
      [wrapper, wrapper, binary],
      'second directory entry',
    ],
    [
      'an entry named <root>-evil/x: a segment match, not a string prefix',
      [wrapper, binary, { name: `${ROOT}-evil/x` }],
      'outside the declared root',
    ],
    [
      'a regular file at archive top level beside root',
      [wrapper, binary, { name: 'README' }],
      'outside the declared root',
    ],
    ['<root>/../x climbs out through the root', [wrapper, { name: `${ROOT}/../x` }], 'climbs out'],
    [
      'a PAX x header inside root',
      [wrapper, binary, { name: `${ROOT}/PaxHeader`, type: 'x' }],
      'PAX extended',
    ],
    [
      'a GNU L header inside root',
      [wrapper, binary, { name: `${ROOT}/@LongLink`, type: 'L' }],
      'GNU long-name',
    ],
    ['a symlink inside root', [wrapper, binary, { name: `${ROOT}/link`, type: '2' }], 'a symlink'],
    [
      'the root entry with size > 0',
      [{ ...wrapper, bytes: bytesOf('x') }, binary],
      'not an empty directory',
    ],
    [
      'the root entry as typeflag 1 (a hard link), not a directory',
      [{ name: `${ROOT}/`, type: '1' }],
      'not an empty directory',
    ],
    [
      'the root entry as typeflag 2 (a symlink), not a directory',
      [{ name: `${ROOT}/`, type: '2' }],
      'not an empty directory',
    ],
    ['a duplicate name after stripping', [wrapper, binary, binary], 'appears twice'],
  ] as const)('%s', (_, entries, message) => {
    expect(refusal(() => read(tarOf(entries), ['alertmanager'], ROOT))).toContain(message);
  });
});
