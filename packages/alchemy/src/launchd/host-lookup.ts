/**
 * User and group lookups, as argv plus a parser — split out so the parsing is tested against the
 * real output shapes without running anything.
 *
 * ★ macOS FIRST, getent ELSEWHERE. macOS has no `getent`; its directory service answers through
 *   `dscacheutil`. Shape MEASURED 2026-09-21 on macOS 27.2 (read-only query):
 *
 *     name: someone
 *     password: ********
 *     uid: 501
 *     gid: 20
 *     dir: /Users/someone
 *     shell: /bin/zsh
 *
 *   An unknown uid printed NOTHING and exited 0 — so "no record" is an empty parse, never an
 *   exit code. `getent` exits 2 for an unknown key; that also parses as no record.
 * ⛔ NEVER PARSE OR KEEP THE `password:` LINE. It is a placeholder on macOS, but a parser that
 *   copies every field would carry a hash from any host where it is not.
 */
import type { HostUser } from './runner.ts';

const NUMERIC = /^\d+$/;

/** argv for looking up a user, by name or numeric id. */
export const userQuery = (platform: string, nameOrId: string): readonly string[] =>
  platform === 'darwin'
    ? [
        '/usr/bin/dscacheutil',
        '-q',
        'user',
        '-a',
        NUMERIC.test(nameOrId) ? 'uid' : 'name',
        nameOrId,
      ]
    : ['getent', 'passwd', nameOrId];

/** argv for looking up a group, by name or numeric id. */
export const groupQuery = (platform: string, nameOrId: string): readonly string[] =>
  platform === 'darwin'
    ? [
        '/usr/bin/dscacheutil',
        '-q',
        'group',
        '-a',
        NUMERIC.test(nameOrId) ? 'gid' : 'name',
        nameOrId,
      ]
    : ['getent', 'group', nameOrId];

/** The first `key: value` record in dscacheutil output, minus any password field. */
const firstRecord = (stdout: string): Map<string, string> => {
  const fields = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') {
      if (fields.size > 0) break; // ⚠️ records are blank-line separated; keep the first only
      continue;
    }
    const at = line.indexOf(': ');
    if (at <= 0) continue;
    const key = line.slice(0, at);
    if (key === 'password') continue;
    fields.set(key, line.slice(at + 2).trim());
  }
  return fields;
};

const toId = (text: string | undefined): number | undefined =>
  text !== undefined && NUMERIC.test(text) ? Number(text) : undefined;

export const parseUser = (platform: string, stdout: string): HostUser | undefined => {
  if (platform === 'darwin') {
    const record = firstRecord(stdout);
    const uid = toId(record.get('uid'));
    const gid = toId(record.get('gid'));
    const home = record.get('dir');
    return uid === undefined || gid === undefined || home === undefined
      ? undefined
      : { gid, home, uid };
  }
  // getent passwd: name:x:uid:gid:gecos:home:shell
  const fields = (stdout.split('\n')[0] ?? '').split(':');
  const uid = toId(fields[2]);
  const gid = toId(fields[3]);
  const home = fields[5];
  return uid === undefined || gid === undefined || home === undefined || home === ''
    ? undefined
    : { gid, home, uid };
};

export const parseGroup = (platform: string, stdout: string): number | undefined => {
  if (platform === 'darwin') return toId(firstRecord(stdout).get('gid'));
  // getent group: name:x:gid:members
  return toId((stdout.split('\n')[0] ?? '').split(':')[2]);
};
