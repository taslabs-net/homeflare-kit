/**
 * sudoRunner over the fake host (fake-sudo.ts): which calls reach sudo, in what exact argv, what
 * is logged, and what is refused before sudo is ever asked. No real sudo runs anywhere.
 * File writes and removes are in sudo-runner-files.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { OPERATOR, PREFIXES, fakeSudoHost } from './fake-sudo.ts';
import { LAUNCHCTL } from './launchctl.ts';
import { RM, SUDO } from './sudo-allowlist.ts';
import { SudoRefusedError, makeSudoRunner, sudoRunner } from './sudo-runner.ts';

const PLIST = '/Library/LaunchDaemons/com.example.a.plist';
const plistBytes = new TextEncoder().encode('<key>Label</key><string>com.example.a</string>');

describe('what it claims', () => {
  test('privileged, as the operator: it elevates calls, it is not root', () => {
    const { runner } = fakeSudoHost();
    expect(runner.privileged).toBe(true);
    expect(runner.effectiveUid()).toBe(OPERATOR);
  });

  test('prefixes are required and checked when it is built', () => {
    expect(() => sudoRunner({ prefixes: [] })).toThrow('no prefixes');
    expect(() => sudoRunner({ prefixes: ['/'] })).toThrow('every path');
  });
});

describe('exec', () => {
  test('a system bootstrap runs as `sudo -n --`, logged once, argv only', async () => {
    const host = fakeSudoHost();
    host.fake.files.set(PLIST, { bytes: plistBytes, gid: 0, kind: 'file', mode: 0o644, uid: 0 });
    const result = await host.runner.exec([LAUNCHCTL, 'bootstrap', 'system', PLIST]);
    expect(result.exitCode).toBe(0);
    expect(host.sudoCalls).toEqual([[SUDO, '-n', '--', LAUNCHCTL, 'bootstrap', 'system', PLIST]]);
    expect(host.logs).toEqual([
      `homeflare/launchd sudo -n ${JSON.stringify([LAUNCHCTL, 'bootstrap', 'system', PLIST])}`,
    ]);
  });

  test('bootstrap of a plist that is not a plain file is refused before sudo', async () => {
    const host = fakeSudoHost();
    await expect(host.runner.exec([LAUNCHCTL, 'bootstrap', 'system', PLIST])).rejects.toThrow(
      'is missing, not a file',
    );
    host.fake.files.set(PLIST, { bytes: plistBytes, gid: 0, kind: 'symlink', mode: 0o755, uid: 0 });
    await expect(host.runner.exec([LAUNCHCTL, 'bootstrap', 'system', PLIST])).rejects.toThrow(
      'is a symlink',
    );
    expect(host.sudoCalls).toEqual([]);
    expect(host.logs).toEqual([]);
  });

  test('reads stay unelevated: no sudo, no log line', async () => {
    const host = fakeSudoHost();
    const result = await host.runner.exec([LAUNCHCTL, 'print', 'system/com.example.a']);
    expect(result.exitCode).toBe(113);
    await host.runner.exec([LAUNCHCTL, 'print-disabled', 'system']);
    expect(host.sudoCalls).toEqual([]);
    expect(host.logs).toEqual([]);
  });

  test.each([
    ['a bare-domain bootout', [LAUNCHCTL, 'bootout', 'system']],
    ["another user's gui domain", [LAUNCHCTL, 'bootout', 'gui/502/com.example.a']],
    ['a sudo argv', [SUDO, '-n', RM, '-rf', '/']],
  ])('%s is refused before sudo is asked', async (_name, argv) => {
    const host = fakeSudoHost();
    await expect(host.runner.exec(argv)).rejects.toBeInstanceOf(SudoRefusedError);
    expect(host.sudoCalls).toEqual([]);
    expect(host.logs).toEqual([]);
  });

  test('a password-required sudo fails at once, saying what to do', async () => {
    const host = fakeSudoHost();
    host.state.sudo = 'password';
    const run = host.runner.exec([LAUNCHCTL, 'bootout', 'system/com.example.a']);
    await expect(run).rejects.toBeInstanceOf(SudoRefusedError);
    await expect(run).rejects.toThrow('a password is required');
    await expect(run).rejects.toThrow('sudo -v');
    expect(host.sudoCalls).toHaveLength(1);
  });

  test('a sudoers refusal is named as one', async () => {
    const host = fakeSudoHost();
    host.state.sudo = 'denied';
    await expect(host.runner.exec([LAUNCHCTL, 'bootout', 'system/com.example.a'])).rejects.toThrow(
      'sudoers does not let',
    );
  });

  test("launchctl's own failure comes back as a result, for the provider to judge", async () => {
    const host = fakeSudoHost();
    const result = await host.runner.exec([LAUNCHCTL, 'bootout', 'system/com.example.a']);
    expect(result.exitCode).toBe(3);
    expect(host.sudoCalls).toHaveLength(1);
  });

  test('a launchctl error that says "not allowed" is still launchctl\'s, not sudo\'s', async () => {
    const host = fakeSudoHost();
    host.fake.files.set(PLIST, { bytes: plistBytes, gid: 0, kind: 'file', mode: 0o644, uid: 0 });
    // ⚠️ Exit 1 like sudo's own failures; only sudo's message forms may turn it into a refusal.
    host.fake.state.bootstrapFailure = {
      exitCode: 1,
      stderr: 'Bootstrap failed: 1: service is not allowed to execute in this domain',
      stdout: '',
    };
    const result = await host.runner.exec([LAUNCHCTL, 'bootstrap', 'system', PLIST]);
    expect(result.exitCode).toBe(1);
  });
});

test('makeSudoRunner validates prefixes too', () => {
  const { fake } = fakeSudoHost();
  const deps = {
    base: fake.runner,
    groups: async () => [],
    log: () => undefined,
    stage: async () => ({ dispose: async () => undefined, path: '' }),
  };
  expect(() => makeSudoRunner([], deps)).toThrow('no prefixes');
  expect(() => makeSudoRunner(PREFIXES, deps)).not.toThrow();
});
