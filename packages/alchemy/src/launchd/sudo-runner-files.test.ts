/**
 * sudoRunner's file writes and removes over the fake host (fake-sudo.ts): under a prefix they go
 * through `install` / `rm` as root; everything a mistaken declaration could turn into a root write
 * somewhere unintended is refused before anything is staged. No real sudo runs anywhere.
 */
import { describe, expect, test } from 'bun:test';
import { OPERATOR, fakeSudoHost } from './fake-sudo.ts';
import { INSTALL, RM } from './sudo-allowlist.ts';

const CONF = '/opt/example/app/a.conf';
const bytes = (text: string) => new TextEncoder().encode(text);
const plistBytes = bytes('<key>Label</key><string>com.example.a</string>');

describe('writeFileAtomic', () => {
  test('under a prefix: staged, installed with mode and owner from argv, staged file removed', async () => {
    const host = fakeSudoHost();
    await host.runner.writeFileAtomic(CONF, bytes('listen: 127.0.0.1:9100\n'), {
      gid: 80,
      mode: 0o640,
      uid: 0,
    });
    const [install] = host.privileged();
    expect(install).toEqual([
      INSTALL,
      '-S',
      '-m',
      '0640',
      '-o',
      '0',
      '-g',
      '80',
      expect.any(String),
      CONF,
    ]);
    expect(host.state.installedFrom.get(CONF)).toBe('listen: 127.0.0.1:9100\n');
    expect(host.fake.files.get(CONF)).toMatchObject({ gid: 80, mode: 0o640, uid: 0 });
    expect(host.staged.size).toBe(0);
    // ⛔ The log carries the argv, never the content.
    expect(host.logs.join('\n')).not.toContain('127.0.0.1');
  });

  test('a failed install throws and still removes the staged file', async () => {
    const host = fakeSudoHost();
    host.state.installFailure = { exitCode: 71, stderr: 'install: disk full', stdout: '' };
    await expect(host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 })).rejects.toThrow(
      '-> 71: install: disk full',
    );
    expect(host.staged.size).toBe(0);
    expect(host.fake.files.has(CONF)).toBe(false);
  });

  test("outside every prefix, the operator's own file is written by the operator", async () => {
    const host = fakeSudoHost();
    const path = '/Users/someone/Library/LaunchAgents/com.example.a.plist';
    await host.runner.writeFileAtomic(path, plistBytes, { mode: 0o644, uid: OPERATOR });
    expect(host.fake.files.get(path)).toMatchObject({ uid: OPERATOR });
    expect(host.sudoCalls).toEqual([]);
  });

  test('outside every prefix, a foreign owner is refused and nothing is written', async () => {
    const host = fakeSudoHost();
    const path = '/Users/someone/Library/LaunchAgents/x.conf';
    await expect(
      host.runner.writeFileAtomic(path, bytes('x'), { mode: 0o644, uid: 502 }),
    ).rejects.toThrow('owner 502 needs root');
    expect(host.fake.files.has(path)).toBe(false);
    expect(host.sudoCalls).toEqual([]);
  });

  test.each([
    ['a directory at the path', '/opt/example/app', 'is a directory'],
    ['a missing directory on the way', '/opt/example/none/a.conf', '/opt/example/none is missing'],
  ])('%s is refused before anything is staged', async (_name, path, message) => {
    const host = fakeSudoHost();
    await expect(host.runner.writeFileAtomic(path, bytes('x'), { mode: 0o644 })).rejects.toThrow(
      message,
    );
    expect(host.state.stagedCount).toBe(0);
    expect(host.sudoCalls).toEqual([]);
  });

  test('a symlinked directory under the prefix is refused', async () => {
    const host = fakeSudoHost();
    host.fake.files.set('/opt/example/link', {
      bytes: bytes(''),
      gid: 0,
      kind: 'symlink',
      mode: 0o755,
      uid: 0,
    });
    await expect(
      host.runner.writeFileAtomic('/opt/example/link/a.conf', bytes('x'), { mode: 0o644 }),
    ).rejects.toThrow('/opt/example/link is a symlink');
    expect(host.sudoCalls).toEqual([]);
  });

  test('a file the operator could not read back is refused before staging', async () => {
    const host = fakeSudoHost();
    await expect(
      host.runner.writeFileAtomic(CONF, bytes('x'), { gid: 0, mode: 0o600, uid: 0 }),
    ).rejects.toThrow('would hide it from the deploying user');
    expect(host.state.stagedCount).toBe(0);
    // Group-readable through one of the operator's groups is fine; so are unknown groups.
    await host.runner.writeFileAtomic(CONF, bytes('x'), { gid: 80, mode: 0o640, uid: 0 });
    await fakeSudoHost('unknown').runner.writeFileAtomic(CONF, bytes('x'), {
      gid: 99,
      mode: 0o640,
      uid: 0,
    });
  });

  test('outside every prefix, EACCES names the missing prefix instead of a temp file', async () => {
    const host = fakeSudoHost();
    await expect(
      host.runner.writeFileAtomic('/etc/example/a.conf', bytes('x'), { mode: 0o644 }),
    ).rejects.toThrow('declare that directory as a prefix');
    await expect(
      host.runner.writeFileAtomic('/nowhere/a.conf', bytes('x'), { mode: 0o644 }),
    ).rejects.toThrow('ENOENT');
  });
});

describe('removeFile', () => {
  test('under a prefix: `rm -f --` through sudo', async () => {
    const host = fakeSudoHost();
    host.fake.files.set(CONF, { bytes: bytes('x'), gid: 0, kind: 'file', mode: 0o644, uid: 0 });
    await host.runner.removeFile(CONF);
    expect(host.privileged()).toEqual([[RM, '-f', '--', CONF]]);
    expect(host.fake.files.has(CONF)).toBe(false);
  });

  test('nothing there is success with no privileged call and no log line', async () => {
    const host = fakeSudoHost();
    await host.runner.removeFile(CONF);
    expect(host.sudoCalls).toEqual([]);
    expect(host.logs).toEqual([]);
  });

  test('a directory is refused, not removed', async () => {
    const host = fakeSudoHost();
    await expect(host.runner.removeFile('/opt/example/app')).rejects.toThrow('is a directory');
    expect(host.sudoCalls).toEqual([]);
  });

  test('outside every prefix it is the operator removing their own file', async () => {
    const host = fakeSudoHost();
    const path = '/Users/someone/Library/LaunchAgents/a.plist';
    host.fake.files.set(path, {
      bytes: bytes('x'),
      gid: 20,
      kind: 'file',
      mode: 0o644,
      uid: OPERATOR,
    });
    await host.runner.removeFile(path);
    expect(host.fake.files.has(path)).toBe(false);
    expect(host.sudoCalls).toEqual([]);
  });
});
