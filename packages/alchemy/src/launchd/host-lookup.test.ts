/**
 * The lookup parsers against the dscacheutil shape measured on macOS 27.2 and getent's documented
 * one — pure strings, nothing runs.
 */
import { describe, expect, test } from 'bun:test';
import { groupQuery, parseGroup, parseUser, userQuery } from './host-lookup.ts';

const DSCACHE_USER = [
  'name: someone',
  'password: ********',
  'uid: 501',
  'gid: 20',
  'dir: /Users/someone',
  'shell: /bin/zsh',
  'gecos: Some One',
  '',
  'name: second',
  'uid: 502',
  'gid: 20',
  'dir: /Users/second',
  '',
].join('\n');

describe('queries', () => {
  test('macOS asks dscacheutil by uid or by name; elsewhere getent', () => {
    expect(userQuery('darwin', '501')).toEqual([
      '/usr/bin/dscacheutil',
      '-q',
      'user',
      '-a',
      'uid',
      '501',
    ]);
    expect(userQuery('darwin', 'someone')).toEqual([
      '/usr/bin/dscacheutil',
      '-q',
      'user',
      '-a',
      'name',
      'someone',
    ]);
    expect(groupQuery('darwin', 'wheel')).toEqual([
      '/usr/bin/dscacheutil',
      '-q',
      'group',
      '-a',
      'name',
      'wheel',
    ]);
    expect(groupQuery('darwin', '0')).toEqual([
      '/usr/bin/dscacheutil',
      '-q',
      'group',
      '-a',
      'gid',
      '0',
    ]);
    expect(userQuery('linux', 'someone')).toEqual(['getent', 'passwd', 'someone']);
    expect(groupQuery('linux', 'wheel')).toEqual(['getent', 'group', 'wheel']);
  });
});

describe('parseUser', () => {
  test('dscacheutil: the first record only, and never the password field', () => {
    const user = parseUser('darwin', DSCACHE_USER);
    expect(user).toEqual({ gid: 20, home: '/Users/someone', uid: 501 });
    expect(JSON.stringify(user)).not.toContain('*');
  });

  test('dscacheutil: an unknown user prints nothing (measured) and parses to undefined', () => {
    expect(parseUser('darwin', '')).toBeUndefined();
    expect(parseUser('darwin', 'name: partial\nuid: 1\n')).toBeUndefined();
  });

  test('getent passwd', () => {
    expect(parseUser('linux', 'someone:x:1000:1000:Some One:/home/someone:/bin/bash\n')).toEqual({
      gid: 1000,
      home: '/home/someone',
      uid: 1000,
    });
    expect(parseUser('linux', '')).toBeUndefined();
  });
});

describe('parseGroup', () => {
  test('dscacheutil and getent', () => {
    expect(parseGroup('darwin', 'name: wheel\npassword: *\ngid: 0\nusers: root\n')).toBe(0);
    expect(parseGroup('darwin', '')).toBeUndefined();
    expect(parseGroup('linux', 'staff:x:50:someone\n')).toBe(50);
    expect(parseGroup('linux', '')).toBeUndefined();
  });
});
