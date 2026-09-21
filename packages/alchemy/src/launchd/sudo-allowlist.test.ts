/**
 * The allowlist, as pure argv checks. Each refusal here is a shape that would do real damage as
 * root; each acceptance is a shape the providers or the runner actually produce.
 */
import { describe, expect, test } from 'bun:test';
import { LAUNCHCTL } from './launchctl.ts';
import {
  INSTALL,
  RM,
  checkPrefixes,
  octalMode,
  prefixOf,
  privilegedProblem,
  routeExec,
} from './sudo-allowlist.ts';

const DAEMONS = '/Library/LaunchDaemons';
const context = { prefixes: [DAEMONS, '/opt/example'], staged: '/tmp/hf-sudo-x/staged' };
const allowed = (argv: string[]) => privilegedProblem(argv, context);
const PLIST = `${DAEMONS}/com.example.a.plist`;

describe('checkPrefixes', () => {
  test.each([
    [[], 'no prefixes'],
    [['/'], 'every path'],
    [['opt/example'], 'absolute'],
    [['/opt/example/'], 'normalised'],
    [['/opt/../etc'], 'normalised'],
  ])('refuses %j', (prefixes, message) => {
    expect(() => checkPrefixes(prefixes)).toThrow(message);
  });

  test('keeps a valid list', () => {
    expect(checkPrefixes([DAEMONS])).toEqual([DAEMONS]);
  });
});

describe('prefixOf', () => {
  test('strictly under, never a sibling with the same leading text, never the prefix itself', () => {
    expect(prefixOf('/opt/example/a.conf', context.prefixes)).toBe('/opt/example');
    expect(prefixOf('/opt/example-other/a.conf', context.prefixes)).toBeUndefined();
    expect(prefixOf('/opt/example', context.prefixes)).toBeUndefined();
  });

  test('a path that walks out with .. is not under anything', () => {
    expect(prefixOf('/opt/example/../../etc/sudoers', context.prefixes)).toBeUndefined();
  });
});

describe('launchctl shapes', () => {
  test.each([
    [[LAUNCHCTL, 'bootstrap', 'system', PLIST]],
    [[LAUNCHCTL, 'bootout', 'system/com.example.a']],
    [[LAUNCHCTL, 'kickstart', 'system/com.example.a']],
    [[LAUNCHCTL, 'kickstart', '-k', '-p', 'system/com.example.a']],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    // ⛔ launchctl(1): a bare domain removes the whole system domain.
    ['bootout of the bare system domain', [LAUNCHCTL, 'bootout', 'system']],
    ['bootout by domain plus path', [LAUNCHCTL, 'bootout', 'system', PLIST]],
    // ⛔ launchctl(1): a directory bootstraps every plist in it.
    ['bootstrap of a directory', [LAUNCHCTL, 'bootstrap', 'system', DAEMONS]],
    ['bootstrap of two plists', [LAUNCHCTL, 'bootstrap', 'system', PLIST, PLIST]],
    [
      'bootstrap outside every prefix',
      [LAUNCHCTL, 'bootstrap', 'system', '/tmp/com.example.a.plist'],
    ],
    ['bootstrap of a non-plist', [LAUNCHCTL, 'bootstrap', 'system', `${DAEMONS}/com.example.a`]],
    // ★ Only where launchd loads daemons at boot: anywhere else is a job that vanishes on restart.
    [
      'bootstrap from another prefix',
      [LAUNCHCTL, 'bootstrap', 'system', '/opt/example/com.example.a.plist'],
    ],
    [
      'bootstrap from a subdirectory',
      [LAUNCHCTL, 'bootstrap', 'system', `${DAEMONS}/sub/com.example.a.plist`],
    ],
    ['bootstrap into a gui domain', [LAUNCHCTL, 'bootstrap', 'gui/501', PLIST]],
    ['a reserved label', [LAUNCHCTL, 'bootout', 'system/com.apple.xpc.foo']],
    ['a label that is a path', [LAUNCHCTL, 'bootout', 'system/../x']],
    [
      'kickstart -s (suspended, for a debugger)',
      [LAUNCHCTL, 'kickstart', '-s', 'system/com.example.a'],
    ],
    ['a repeated flag', [LAUNCHCTL, 'kickstart', '-k', '-k', 'system/com.example.a']],
    ['kickstart of the bare domain', [LAUNCHCTL, 'kickstart', '-k', 'system']],
    ['kickstart of a reserved label', [LAUNCHCTL, 'kickstart', 'system/com.apple.xpc.foo']],
    ['enable', [LAUNCHCTL, 'enable', 'system/com.example.a']],
    ['print, which never needs root', [LAUNCHCTL, 'print', 'system/com.example.a']],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

test('without /Library/LaunchDaemons declared, bootstrap and bootout are refused; kickstart is not', () => {
  const narrow = { prefixes: ['/opt/example'] };
  // ⚠️ bootout first, then a refused rm, would leave a plist launchd loads again at boot.
  expect(privilegedProblem([LAUNCHCTL, 'bootout', 'system/com.example.a'], narrow)).toContain(
    '/Library/LaunchDaemons',
  );
  expect(privilegedProblem([LAUNCHCTL, 'bootstrap', 'system', PLIST], narrow)).toContain(
    '/Library/LaunchDaemons',
  );
  expect(
    privilegedProblem([LAUNCHCTL, 'kickstart', 'system/com.example.a'], narrow),
  ).toBeUndefined();
});

describe('install and rm shapes', () => {
  const staged = context.staged;
  test.each([
    [[INSTALL, '-S', '-m', '0644', staged, '/opt/example/a.conf']],
    [[INSTALL, '-S', '-m', '4755', '-o', '0', staged, '/opt/example/a']],
    [[INSTALL, '-S', '-m', '0644', '-g', '80', staged, '/opt/example/a']],
    [[INSTALL, '-S', '-m', '0644', '-o', '0', '-g', '0', staged, PLIST]],
    [[RM, '-f', '--', '/opt/example/a.conf']],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    // ⛔ Copying any other source would publish a root-only file.
    [
      'a source it did not stage',
      [INSTALL, '-S', '-m', '0644', '/etc/master.passwd', '/opt/example/a'],
    ],
    ['a destination outside every prefix', [INSTALL, '-S', '-m', '0644', staged, '/etc/sudoers']],
    ['a destination that walks out', [INSTALL, '-S', '-m', '0644', staged, '/opt/example/../x']],
    ['no -S', [INSTALL, '-m', '0644', staged, '/opt/example/a']],
    ['a three-digit mode', [INSTALL, '-S', '-m', '644', staged, '/opt/example/a']],
    ['a symbolic mode', [INSTALL, '-S', '-m', 'u+s', staged, '/opt/example/a']],
    ['an owner by name', [INSTALL, '-S', '-m', '0644', '-o', 'root', staged, '/opt/example/a']],
    ['-g before -o', [INSTALL, '-S', '-m', '0644', '-g', '0', '-o', '0', staged, '/opt/example/a']],
    ['-d (make directories)', [INSTALL, '-S', '-m', '0644', '-d', staged, '/opt/example/a']],
    ['two destinations', [INSTALL, '-S', '-m', '0644', staged, '/opt/example/a', '/opt/example/b']],
    ['rm -r', [RM, '-rf', '--', '/opt/example/a']],
    ['rm without --', [RM, '-f', '/opt/example/a']],
    ['rm of two paths', [RM, '-f', '--', '/opt/example/a', '/opt/example/b']],
    ['rm of a prefix itself', [RM, '-f', '--', '/opt/example']],
    ['any other program', ['/bin/sh', '-c', 'true']],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });

  test('without a staged file, no install is allowed at all', () => {
    const argv = [INSTALL, '-S', '-m', '0644', 'undefined', '/opt/example/a'];
    expect(privilegedProblem(argv, { prefixes: context.prefixes })).toBeString();
  });

  test('octalMode is four digits, and refuses what chmod cannot mean', () => {
    expect(octalMode(0o644)).toBe('0644');
    expect(octalMode(0o4755)).toBe('4755');
    expect(octalMode(0o10000)).toBeUndefined();
    expect(octalMode(-1)).toBeUndefined();
    expect(octalMode(1.5)).toBeUndefined();
  });
});

describe('routeExec', () => {
  const route = (argv: string[]) => routeExec(argv, 501);
  test('system-domain writes go to root', () => {
    expect(route([LAUNCHCTL, 'bootstrap', 'system', PLIST])).toEqual({ as: 'root' });
    expect(route([LAUNCHCTL, 'bootout', 'system/com.example.a'])).toEqual({ as: 'root' });
    expect(route([LAUNCHCTL, 'kickstart', '-k', 'system/com.example.a'])).toEqual({ as: 'root' });
    // A malformed system write still routes to root, where the allowlist refuses it.
    expect(route([LAUNCHCTL, 'bootout', 'system'])).toEqual({ as: 'root' });
  });

  test('reads, lookups and the operator’s own gui domain stay unelevated', () => {
    expect(route([LAUNCHCTL, 'print', 'system/com.example.a'])).toEqual({ as: 'operator' });
    expect(route([LAUNCHCTL, 'print-disabled', 'system'])).toEqual({ as: 'operator' });
    expect(route([LAUNCHCTL, 'bootstrap', 'gui/501', '/Users/x/a.plist'])).toEqual({
      as: 'operator',
    });
    expect(route([LAUNCHCTL, 'bootout', 'gui/501/com.example.a'])).toEqual({ as: 'operator' });
    expect(route(['/usr/bin/dscacheutil', '-q', 'user'])).toEqual({ as: 'operator' });
  });

  test('another user’s domain is refused, not passed through to fail on EPERM', () => {
    expect(route([LAUNCHCTL, 'bootout', 'gui/502/com.example.a'])).toHaveProperty('refuse');
    expect(route([LAUNCHCTL, 'kickstart', 'user/502/com.example.a'])).toHaveProperty('refuse');
  });

  test('a sudo argv is never passed through', () => {
    expect(route(['/usr/bin/sudo', '-n', '/bin/rm', '-rf', '/'])).toHaveProperty('refuse');
    expect(route(['sudo', 'true'])).toHaveProperty('refuse');
  });
});
