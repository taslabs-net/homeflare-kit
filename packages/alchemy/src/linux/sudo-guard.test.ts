/**
 * assertGuardedChain against the fake Linux host, unprivileged: a symlink below the prefix, a
 * group-writable directory, a `+` ACL flag, a non-root owner above the prefix, and a directory
 * sitting where a write expects `absent`. No sudo call anywhere in this file.
 */
import { describe, expect, test } from 'bun:test';
import { fakeSudoHost } from './fake-sudo.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';
import { assertGuardedChain } from './sudo-guard.ts';

describe('a clean prefix', () => {
  test('a file-or-absent target that is absent is fine', async () => {
    const { base } = fakeSudoHost();
    const target = await assertGuardedChain(
      base,
      '/etc/systemd/system',
      '/etc/systemd/system/thing.service',
      'file-or-absent',
    );
    expect(target).toBeUndefined();
  });

  test('mkdir\'s "absent" expectation refuses a directory already there', async () => {
    const { base } = fakeSudoHost({ '/usr/local/bin/sub': 0 });
    await expect(
      assertGuardedChain(base, '/usr/local/bin', '/usr/local/bin/sub', 'absent'),
    ).rejects.toThrow('already exists');
  });
});

describe('a symlink in the chain', () => {
  test('below the prefix is refused, even root-owned', async () => {
    const { base, fake } = fakeSudoHost();
    fake.files.set('/etc/systemd/system/sub', {
      bytes: new Uint8Array(),
      gid: 0,
      kind: 'symlink',
      mode: 0o777,
      uid: 0,
    });
    await expect(
      assertGuardedChain(
        base,
        '/etc/systemd/system',
        '/etc/systemd/system/sub/x.service',
        'file-or-absent',
      ),
    ).rejects.toBeInstanceOf(SudoRefusedError);
  });

  test('above the prefix, root-owned, is followed like the merged-/usr symlinks it models', async () => {
    const { base, fake } = fakeSudoHost();
    fake.files.set('/etc', {
      bytes: new Uint8Array(),
      gid: 0,
      kind: 'symlink',
      mode: 0o777,
      uid: 0,
    });
    const target = await assertGuardedChain(
      base,
      '/etc/systemd/system',
      '/etc/systemd/system/thing.service',
      'file-or-absent',
    );
    expect(target).toBeUndefined();
  });

  test('above the prefix, owned by someone else, is refused (not treated as the system’s own)', async () => {
    const { base, fake } = fakeSudoHost();
    fake.files.set('/etc', {
      bytes: new Uint8Array(),
      gid: 0,
      kind: 'symlink',
      mode: 0o777,
      uid: 900,
    });
    await expect(
      assertGuardedChain(
        base,
        '/etc/systemd/system',
        '/etc/systemd/system/thing.service',
        'file-or-absent',
      ),
    ).rejects.toThrow('is a symlink, not a directory');
  });
});

test('a group-writable directory in the chain is refused', async () => {
  const { base, fake } = fakeSudoHost({ '/etc/systemd/system/sub': 0 });
  const live = fake.modes.get('/etc/systemd/system/sub');
  if (live !== undefined) live.mode = 0o775;
  await expect(
    assertGuardedChain(
      base,
      '/etc/systemd/system',
      '/etc/systemd/system/sub/x.service',
      'file-or-absent',
    ),
  ).rejects.toThrow('writable by group or other');
});

test('an ACL `+` flag anywhere in the chain is refused, fail closed', async () => {
  const { base } = fakeSudoHost({}, new Set(['/etc/systemd/system']));
  await expect(
    assertGuardedChain(
      base,
      '/etc/systemd/system',
      '/etc/systemd/system/thing.service',
      'file-or-absent',
    ),
  ).rejects.toThrow('POSIX ACL');
});

test('a non-root owner above the prefix is refused', async () => {
  const { base, fake } = fakeSudoHost();
  const live = fake.modes.get('/etc/systemd/system');
  if (live !== undefined) live.uid = 0; // keep the prefix itself root-owned
  fake.dirs.set('/etc', 900);
  fake.modes.set('/etc', { gid: 0, mode: 0o755, uid: 900 });
  await expect(
    assertGuardedChain(
      base,
      '/etc/systemd/system',
      '/etc/systemd/system/thing.service',
      'file-or-absent',
    ),
  ).rejects.toThrow('not root');
});

test('a directory at a "file" destination is the trap install/rm must not fall into', async () => {
  const { base } = fakeSudoHost({ '/etc/systemd/system/adir': 0 });
  await expect(
    assertGuardedChain(base, '/etc/systemd/system', '/etc/systemd/system/adir', 'file'),
  ).rejects.toThrow('is a directory, not a file');
});
