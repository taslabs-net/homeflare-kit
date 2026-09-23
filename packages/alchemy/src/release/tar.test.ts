/**
 * The tar reader against archives built here, byte by byte: it hands back only what was asked for,
 * by exact name, and refuses the WHOLE archive for any entry that could make a name lie — whether
 * or not that entry was the one asked for.
 */
import { describe, expect, test } from 'bun:test';
import { extractMembers } from './archive.ts';
import { type TarEntry, bytesOf, gzip, tarHeader, tarOf } from './fake-release.ts';
import { ArchiveRefused } from './refused.ts';
import { tarReader } from './tar.ts';

const binary = { bytes: bytesOf('#!binary\n'), name: 'vmalert-prod' } as const;
const read = (tar: Uint8Array, wanted = ['vmalert-prod'], chunk = tar.length) => {
  const reader = tarReader(new Set(wanted));
  for (let at = 0; at < tar.length; at += chunk) reader.push(tar.subarray(at, at + chunk));
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

describe('reading', () => {
  test('only the asked-for member comes back; every name is listed', () => {
    const tar = tarOf([{ bytes: bytesOf('x'.repeat(700)), name: 'vmagent-prod' }, binary]);
    const { members, names } = read(tar);
    expect([...members.keys()]).toEqual(['vmalert-prod']);
    expect(new TextDecoder().decode(members.get('vmalert-prod'))).toBe('#!binary\n');
    expect(names).toEqual(['vmagent-prod', 'vmalert-prod']);
  });

  test('one byte at a time reads the same as all at once', () => {
    const tar = tarOf([{ bytes: bytesOf('y'.repeat(1025)), name: 'vmagent-prod' }, binary]);
    expect(read(tar, ['vmagent-prod', 'vmalert-prod'], 1).members).toEqual(
      read(tar, ['vmagent-prod', 'vmalert-prod']).members,
    );
  });

  test('matching is exact: no ./, no prefix, no suffix', () => {
    const tar = tarOf([
      { ...binary, name: './vmalert-prod' },
      { ...binary, name: 'vmalert-prod-x' },
    ]);
    expect(read(tar).members.size).toBe(0);
  });

  test('a POSIX prefix is part of the name', () => {
    const tar = tarOf([{ ...binary, format: 'posix', prefix: 'bin' }]);
    expect(read(tar, ['bin/vmalert-prod']).members.size).toBe(1);
    expect(read(tar).members.size).toBe(0);
  });

  test('an empty member and trailing zero padding are fine', () => {
    const tar = tarOf([{ name: 'empty' }, binary], 10_240);
    expect(read(tar, ['empty']).members.get('empty')?.length).toBe(0);
  });

  test('extractMembers gunzips as it reads', async () => {
    const { members } = await extractMembers(gzip(tarOf([binary])), new Set(['vmalert-prod']));
    expect(members.get('vmalert-prod')).toEqual(binary.bytes);
  });
});

describe('tar-slip and every other entry that could lie is refused, asked for or not', () => {
  const beside = (entry: TarEntry) => tarOf([binary, entry]);
  test.each([
    ['an absolute name', { name: '/etc/passwd' }, 'is absolute'],
    ['a .. segment', { name: '../vmalert-prod' }, 'climbs out'],
    ['a .. deeper in', { name: 'bin/../../x' }, 'climbs out'],
    ['a symlink', { name: 'link', type: '2' }, 'a symlink'],
    ['a hard link', { name: 'hard', type: '1' }, 'a hard link'],
    ['a directory', { name: 'bin/', type: '5' }, 'a directory'],
    ['a FIFO', { name: 'fifo', type: '6' }, 'a FIFO'],
    ['a GNU long name', { name: '././@LongLink', type: 'L' }, 'GNU long-name'],
    ['a PAX header', { name: 'PaxHeader', type: 'x' }, 'PAX extended'],
    ['an unknown type', { name: 'odd', type: 'Z' }, 'unknown type'],
    ['a repeated name', binary, 'appears twice'],
    ['a failed header checksum', { corruptChecksum: true, name: 'x' }, 'fails its checksum'],
    ['a base-256 size', { base256: true, bytes: bytesOf('z'), name: 'big' }, 'base-256'],
    ['a character device', { name: 'tty', type: '3' }, 'a character device'],
    ['a block device', { name: 'disk', type: '4' }, 'a block device'],
    ['a contiguous file', { name: 'contig', type: '7' }, 'a contiguous file'],
    ['a GNU long link', { name: '././@LongLink', type: 'K' }, 'GNU long-link'],
    ['a PAX global header', { name: 'pax_global_header', type: 'g' }, 'PAX global'],
    ['an empty name', { bytes: bytesOf('z'), name: '' }, 'empty name'],
  ] as const)('%s', (_, entry, message) => {
    expect(refusal(() => read(beside(entry)))).toContain(message);
  });

  test('a name that is not UTF-8 is refused, not decoded loosely into another name', () => {
    const tar = tarOf([binary, { bytes: bytesOf('z'), name: 'x' }]);
    const at = 1024; // the second header: one header block and one data block in
    tar[at] = 0xff;
    tar.fill(0x20, at + 148, at + 156);
    const sum = tar.subarray(at, at + 512).reduce((total, byte) => total + byte, 0);
    tar.set(bytesOf(`${sum.toString(8).padStart(6, '0')}\0 `), at + 148);
    expect(refusal(() => read(tar))).toContain('not UTF-8');
  });

  test('a symlink under the asked-for name is refused, not followed', () => {
    expect(refusal(() => read(tarOf([{ name: 'vmalert-prod', type: '2' }])))).toContain('symlink');
  });

  test('a header that is neither ustar nor GNU (v7 tar) is refused', () => {
    const tar = tarOf([binary]);
    tar.fill(0, 257, 265);
    const header = tarHeader(binary);
    header.fill(0, 257, 265);
    header.fill(0x20, 148, 156);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
    tar.set(header, 0);
    expect(refusal(() => read(tar))).toContain('neither ustar nor GNU');
  });

  test('a truncated archive — no end marker — is refused', () => {
    const tar = tarOf([binary]);
    expect(refusal(() => read(tar.subarray(0, tar.length - 1024)))).toContain('stops before');
  });

  test('a lone zero block between entries is refused', () => {
    const one = tarOf([binary], 512);
    const two = tarOf([{ ...binary, name: 'other' }]);
    const spliced = new Uint8Array([...one, ...two]);
    expect(refusal(() => read(spliced))).toContain('zero block');
  });

  test('data after the end marker is refused', () => {
    const tar = new Uint8Array([...tarOf([binary]), 1]);
    expect(refusal(() => read(tar))).toContain('follows the end-of-archive');
  });

  test('bytes that are not gzip are refused as an archive, not thrown raw', async () => {
    const promise = extractMembers(bytesOf('not gzip at all'), new Set(['x']));
    await expect(promise).rejects.toBeInstanceOf(ArchiveRefused);
  });
});
