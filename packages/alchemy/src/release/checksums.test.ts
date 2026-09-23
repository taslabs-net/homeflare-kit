/**
 * The checksum-file parser, held to the one format it was measured on (`sha256sum` text mode,
 * 2026-09-22): anything else is a vendor change to read before a pin moves, so it throws.
 */
import { describe, expect, test } from 'bun:test';
import { parseChecksums } from './checksums.ts';

const line = `${'a'.repeat(64)}  vmagent-prod`;

describe('parseChecksums is strict', () => {
  test('the measured shape: name → digest, in file order', () => {
    const text = `${'b'.repeat(64)}  vmutils.tar.gz\n${line}\n`;
    expect([...parseChecksums(text).entries()]).toEqual([
      ['vmutils.tar.gz', 'b'.repeat(64)],
      ['vmagent-prod', 'a'.repeat(64)],
    ]);
  });

  test.each([
    ['CRLF endings', `${line}\r\n`],
    ['a binary-mode marker', `${'a'.repeat(64)} *vmagent-prod\n`],
    ['upper-case hex', `${'A'.repeat(64)}  vmagent-prod\n`],
    ['a blank line', `${line}\n\n`],
    ['no trailing newline', line],
    ['a name listed twice', `${line}\n${line}\n`],
    ['a path in a name', `${'a'.repeat(64)}  bin/vmagent-prod\n`],
    ['an empty file', '\n'],
    ['a tab for the two spaces', `${'a'.repeat(64)}\tvmagent-prod\n`],
    ['one space', `${'a'.repeat(64)} vmagent-prod\n`],
    ['a trailing space (a name that merely starts with another)', `${line} \n`],
    ['a no-break space in the name', `${line}\u00a0-enterprise\n`],
  ])('refuses %s', (_, text) => {
    expect(() => parseChecksums(text)).toThrow();
  });
});
