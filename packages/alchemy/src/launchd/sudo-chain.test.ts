/**
 * sudoRunner's red-team refusals (2026-09-21), over the fake host (fake-sudo.ts): a directory ABOVE
 * the prefix that someone other than root may change, and an ACL anywhere from / down that grants a
 * write right. Either lets that someone swap the path between the guard and `sudo -n`. Each is
 * refused before anything is staged or run as root, and at plan time through `checkWrite`.
 */
import { describe, expect, test } from 'bun:test';
import { OPERATOR, fakeSudoHost } from './fake-sudo.ts';
import { diffFile, reconcileFile } from './host-file-lifecycle.ts';
import type { HostRunner } from './runner.ts';
import { aclGrants, assertNoAclGrants } from './sudo-acl.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';
import { aboveDirs } from './sudo-guard.ts';

const CONF = '/opt/example/app/a.conf';
const bytes = (text: string) => new TextEncoder().encode(text);
type Host = ReturnType<typeof fakeSudoHost>;
const entry = (kind: 'directory' | 'symlink', mode: number, uid = 0) => ({
  bytes: bytes(''),
  gid: 0,
  kind,
  mode,
  uid,
});

/** As `ls -lden` printed them on macOS 27.2 (sudo-acl.ts): a UUID qualifier, one entry a line. */
const UUID = 'ABCDEFAB-CDEF-ABCD-EFAB-CDEF00000014';

test('aboveDirs is / down to the parent of the prefix', () => {
  expect(aboveDirs('/Library/LaunchDaemons')).toEqual(['/', '/Library']);
  expect(aboveDirs('/opt/example')).toEqual(['/', '/opt']);
  expect(aboveDirs('/opt')).toEqual(['/']);
});

describe('aclGrants', () => {
  test('an allow of a write right counts; deny, and read-only rights, do not', () => {
    const listing = [
      `drwxr-xr-x@ 3 0 0 96 Sep 21 19:36 /opt/example`,
      ` 0: ${UUID} allow add_file,add_subdirectory,delete_child`,
      ` 1: ${UUID} inherited allow write,file_inherit`,
      ` 2: ${UUID} deny delete`,
      ` 3: ${UUID} allow list,search,readattr`,
    ].join('\n');
    expect(aclGrants(listing)).toEqual([
      `0: ${UUID} allow add_file,add_subdirectory,delete_child`,
      `1: ${UUID} inherited allow write,file_inherit`,
    ]);
  });

  test('fails closed when the ACLs cannot be read', async () => {
    const base = { exec: async () => ({ exitCode: 1, stderr: 'ls: x', stdout: '' }) };
    const read = assertNoAclGrants(base as unknown as HostRunner, CONF, ['/']);
    await expect(read).rejects.toThrow('could not read the ACLs');
  });
});

const refusedBeforeSudo = async (host: Host, says: string | RegExp) => {
  const write = host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 });
  await expect(write).rejects.toBeInstanceOf(SudoRefusedError);
  await expect(write).rejects.toThrow(says);
  expect(host.state.stagedCount).toBe(0);
  expect(host.sudoCalls).toEqual([]);
};

describe('every directory above the prefix', () => {
  test.each([
    ['owned by the operator', (h: Host) => h.fake.dirs.set('/opt', OPERATOR), 'uid 501'],
    ['group-writable', (h: Host) => h.fake.files.set('/opt', entry('directory', 0o775)), '0775'],
    [
      'a symlink the operator owns',
      (h: Host) => h.fake.files.set('/opt', entry('symlink', 0o755, OPERATOR)),
      'symlink',
    ],
  ] as const)('%s is refused before staging or sudo', async (_n, setup, says) => {
    const host = fakeSudoHost();
    setup(host);
    await refusedBeforeSudo(host, says);
    await expect(host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 })).rejects.toThrow(
      /\/opt, above the declared prefix \/opt\/example/,
    );
  });

  test("a root-owned symlink (/etc -> private/etc) is root's own, and followed", async () => {
    const host = fakeSudoHost();
    host.fake.files.set('/opt', entry('symlink', 0o755));
    await host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 });
    expect(host.fake.files.get(CONF)).toMatchObject({ mode: 0o644, uid: 0 });
  });

  test('a HostFile plan that would write under it fails, still without sudo', async () => {
    const host = fakeSudoHost();
    const output = await reconcileFile(host.runner, { content: 'x', path: CONF });
    host.fake.dirs.set('/opt', OPERATOR);
    const before = host.sudoCalls.length;
    await expect(diffFile(host.runner, { content: 'y', path: CONF }, output)).rejects.toThrow(
      'uid 501',
    );
    expect(host.sudoCalls).toHaveLength(before);
  });
});

describe('an ACL from / down to the file', () => {
  test.each(['/', '/opt', '/opt/example', '/opt/example/app'])(
    'that grants a write right on %s is refused before staging or sudo',
    async (dir) => {
      const host = fakeSudoHost();
      host.fake.acls.set(dir, [` 0: ${UUID} allow add_file,delete_child`]);
      await refusedBeforeSudo(host, 'carries an ACL');
      host.fake.files.set(CONF, { bytes: bytes('x'), gid: 0, kind: 'file', mode: 0o644, uid: 0 });
      await expect(host.runner.removeFile(CONF)).rejects.toThrow('carries an ACL');
      expect(host.sudoCalls).toEqual([]);
    },
  );

  test('a deny-only ACL (as on a home folder) is no refusal', async () => {
    const host = fakeSudoHost();
    host.fake.acls.set('/opt/example/app', [` 0: ${UUID} deny delete`]);
    await host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 });
    expect(host.fake.files.get(CONF)).toMatchObject({ uid: 0 });
  });
});
