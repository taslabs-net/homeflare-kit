/**
 * The allowlist, as pure argv checks — no ssh, no fake host. Each refusal here is a shape that
 * would do real damage as root; each acceptance is a shape sshSudoRunner actually produces.
 */
import { describe, expect, test } from 'bun:test';
import {
  type AllowContext,
  CHMOD,
  CHOWN,
  INSTALL,
  MKDIR,
  MV,
  RM,
  RMDIR,
  SYSTEMCTL_ABS,
  canonicalize,
  checkPrefixes,
  octalMode,
  prefixOf,
  privilegedProblem,
  routeExec,
} from './sudo-allowlist.ts';

const PREFIXES = ['/etc/systemd/system', '/usr/local/bin'];
const STAGED = '/tmp/hf-sudo-1/staged';
const TEMP = '/etc/systemd/system/.thing.service.hf-abcdef012345.tmp';
const context: AllowContext = { prefixes: PREFIXES, staged: STAGED, temp: TEMP };
const allowed = (argv: string[]) => privilegedProblem(argv, context);

describe('checkPrefixes / prefixOf', () => {
  test('reused from the Mac allowlist unchanged', () => {
    expect(() => checkPrefixes([])).toThrow('no prefixes');
    expect(checkPrefixes(PREFIXES)).toEqual(PREFIXES);
    expect(prefixOf('/etc/systemd/system/x.service', PREFIXES)).toBe('/etc/systemd/system');
    expect(prefixOf('/etc/systemd/system-other/x', PREFIXES)).toBeUndefined();
    expect(octalMode(0o644)).toBe('0644');
  });
});

describe('install shapes', () => {
  test.each([
    [[INSTALL, '-m', '0644', '-T', '--', STAGED, TEMP]],
    [[INSTALL, '-m', '0755', '-T', '--', STAGED, TEMP]],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    ['a source it did not stage', [INSTALL, '-m', '0644', '-T', '--', '/etc/master.passwd', TEMP]],
    [
      'a target that is not the derived temp',
      [INSTALL, '-m', '0644', '-T', '--', STAGED, '/etc/systemd/system/x.service'],
    ],
    ['a temp outside every prefix', [INSTALL, '-m', '0644', '-T', '--', STAGED, '/tmp/x.tmp']],
    ['no -T', [INSTALL, '-m', '0644', '--', STAGED, TEMP]],
    ['a three-digit mode', [INSTALL, '-m', '644', '-T', '--', STAGED, TEMP]],
    ['-S (the Mac flag)', [INSTALL, '-S', '-m', '0644', '-T', '--', STAGED, TEMP]],
    ['two destinations', [INSTALL, '-m', '0644', '-T', '--', STAGED, TEMP, TEMP]],
    // 🔴 Adversarial review, round 2: install has no `+`-forcing mechanism at all (coreutils'
    //   `get_ids()` always tries getpwnam/getgrnam first), so -o/-g are refused outright now —
    //   ownership is set afterward by a separate, `+`-forced chown on the same temp (below).
    ['-o, now refused outright', [INSTALL, '-m', '0644', '-o', '0', '-T', '--', STAGED, TEMP]],
    ['-g, now refused outright', [INSTALL, '-m', '0644', '-g', '0', '-T', '--', STAGED, TEMP]],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

describe('the file-ownership chown, bound to the derived temp', () => {
  test.each([
    [[CHOWN, '+900', '--', TEMP]],
    [[CHOWN, ':+60', '--', TEMP]],
    [[CHOWN, '+900:+60', '--', TEMP]],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    ['a bare digit, not +-forced', [CHOWN, '900', '--', TEMP]],
    ['a name', [CHOWN, '+root', '--', TEMP]],
    ['a path that is not the derived temp', [CHOWN, '+900', '--', '/usr/local/bin/other']],
    ['only the group side forced', [CHOWN, '900:+60', '--', TEMP]],
    ['only the owner side forced', [CHOWN, '+900:60', '--', TEMP]],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

describe('mv and rm shapes', () => {
  test.each([
    [[MV, '-f', '-T', '--', TEMP, '/etc/systemd/system/thing.service']],
    [[RM, '-f', '--', TEMP]],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    [
      'mv source not the derived temp',
      [MV, '-f', '-T', '--', '/etc/systemd/system/other.tmp', '/etc/systemd/system/thing.service'],
    ],
    ['mv to another directory', [MV, '-f', '-T', '--', TEMP, '/usr/local/bin/thing']],
    ['mv without -T', [MV, '-f', '--', TEMP, '/etc/systemd/system/thing.service']],
    ['rm -r', [RM, '-rf', '--', TEMP]],
    ['rm without --', [RM, '-f', TEMP]],
    ['rm outside every prefix', [RM, '-f', '--', '/tmp/x']],
    ['sudo in argv', ['/usr/bin/sudo', '-n', RM, '-f', '--', TEMP]],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

describe('directory shapes', () => {
  test.each([
    [[MKDIR, '-m', '750', '--', '/etc/systemd/system/sub']],
    [[MKDIR, '-m', '700', '--', '/etc/systemd/system/sub']],
    [[CHMOD, '750', '--', '/usr/local/bin/sub']],
    // ★ +-forced: this is what canonicalize() actually sends to sudo for a directory chown; the
    //   bare `0`/`:0`/`0:0` directory-lifecycle.ts itself sends is covered by the canonicalize
    //   test below, and is refused HERE on purpose (privilegedProblem checks the final argv).
    [[CHOWN, '+0', '--', '/usr/local/bin/sub']],
    [[CHOWN, ':+0', '--', '/usr/local/bin/sub']],
    [[CHOWN, '+0:+0', '--', '/usr/local/bin/sub']],
    [[RMDIR, '--', '/etc/systemd/system/sub']],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    ['a relative path', [MKDIR, '-m', '750', '--', 'etc/x']],
    ['a prefix-sibling', [MKDIR, '-m', '750', '--', '/usr/local/bin-x/sub']],
    ['a path that walks out', [MKDIR, '-m', '750', '--', '/etc/systemd/system/../x']],
    ['chown by name', [CHOWN, 'root', '--', '/usr/local/bin/sub']],
    [
      'chown, bare digit not +-forced (round 2 of the review)',
      [CHOWN, '0', '--', '/usr/local/bin/sub'],
    ],
    ['chmod without --', [CHMOD, '750', '/usr/local/bin/sub']],
    ['rmdir of two paths', [RMDIR, '--', '/usr/local/bin/sub', '/etc/systemd/system/sub']],
    // 🔴 The three shapes the adversarial review found reachable, 2026-09-23 — see
    //   sudo-allowlist-dir.ts's header. Each must now be refused, not merely shaped correctly.
    ['mkdir with setuid (4750)', [MKDIR, '-m', '4750', '--', '/etc/systemd/system/sub']],
    ['mkdir world-writable (0777)', [MKDIR, '-m', '777', '--', '/etc/systemd/system/sub']],
    [
      'mkdir setgid + group-writable (2775)',
      [MKDIR, '-m', '2775', '--', '/etc/systemd/system/sub'],
    ],
    ['chmod group-writable (0775)', [CHMOD, '775', '--', '/usr/local/bin/sub']],
    ['chown to a non-root uid', [CHOWN, '900', '--', '/usr/local/bin/sub']],
    ['chown to a non-root gid only', [CHOWN, ':60', '--', '/usr/local/bin/sub']],
    ['chown to a non-root uid and gid', [CHOWN, '900:60', '--', '/usr/local/bin/sub']],
    ['chown to a non-root uid, even +-forced', [CHOWN, '+900', '--', '/usr/local/bin/sub']],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

describe('systemctl shapes', () => {
  test.each([
    [[SYSTEMCTL_ABS, 'daemon-reload']],
    [[SYSTEMCTL_ABS, 'enable', '--', 'thing.service']],
    [[SYSTEMCTL_ABS, 'disable', '--', 'thing.service']],
    [[SYSTEMCTL_ABS, 'start', '--', 'thing.timer']],
    [[SYSTEMCTL_ABS, 'restart', '--', 'thing.service']],
  ])('allows %j', (argv) => {
    expect(allowed(argv)).toBeUndefined();
  });

  test.each([
    ['--user', [SYSTEMCTL_ABS, '--user', 'enable', '--', 'thing.service']],
    ['stop with two units', [SYSTEMCTL_ABS, 'stop', '--', 'a.service', 'b.service']],
    ['mask', [SYSTEMCTL_ABS, 'mask', '--', 'thing.service']],
    ['daemon-reload with an operand', [SYSTEMCTL_ABS, 'daemon-reload', 'thing.service']],
    ['a unit that is not a valid name', [SYSTEMCTL_ABS, 'enable', '--', 'not a unit']],
  ])('refuses %s', (_name, argv) => {
    expect(allowed(argv)).toBeString();
  });
});

describe('canonicalize', () => {
  test('rewrites a bare directory chown to the +-forced form the allowlist now requires', () => {
    expect(canonicalize(['chown', '0', '--', '/usr/local/bin/sub'])).toEqual([
      CHOWN,
      '+0',
      '--',
      '/usr/local/bin/sub',
    ]);
    expect(canonicalize(['chown', ':0', '--', '/usr/local/bin/sub'])).toEqual([
      CHOWN,
      ':+0',
      '--',
      '/usr/local/bin/sub',
    ]);
    expect(canonicalize(['chown', '900:60', '--', '/usr/local/bin/sub'])).toEqual([
      CHOWN,
      '+900:+60',
      '--',
      '/usr/local/bin/sub',
    ]);
  });

  test('leaves every other program alone', () => {
    expect(canonicalize(['mkdir', '-m', '750', '--', '/usr/local/bin/sub'])).toEqual([
      MKDIR,
      '-m',
      '750',
      '--',
      '/usr/local/bin/sub',
    ]);
  });
});

describe('routeExec', () => {
  const route = (argv: string[]) => routeExec(argv, PREFIXES);

  test('systemctl write verbs always attempt root, even malformed', () => {
    expect(route([SYSTEMCTL_ABS, 'daemon-reload'])).toEqual({ as: 'root' });
    expect(route(['systemctl', 'enable', '--', 'thing.service'])).toEqual({ as: 'root' });
    expect(route(['systemctl', 'stop', '--', 'a', 'b'])).toEqual({ as: 'root' });
  });

  test('systemctl reads stay unelevated', () => {
    expect(route(['systemctl', 'show', '-p', 'LoadState', '--', 'thing.service'])).toEqual({
      as: 'operator',
    });
  });

  test('directory programs go to root only under a declared prefix', () => {
    expect(route(['mkdir', '-m', '750', '--', '/usr/local/bin/sub'])).toEqual({ as: 'root' });
    expect(route(['mkdir', '-m', '750', '--', '/opt/elsewhere'])).toEqual({ as: 'operator' });
  });

  test('the absolute program spelling routes the same as the bare one', () => {
    expect(route([MKDIR, '-m', '750', '--', '/usr/local/bin/sub'])).toEqual({ as: 'root' });
    expect(route([CHOWN, '0', '--', '/usr/local/bin/sub'])).toEqual({ as: 'root' });
  });

  test('a sudo argv is refused outright, bare or absolute', () => {
    expect(route(['/usr/bin/sudo', '-n', RM, '-f', '--', '/etc/x'])).toHaveProperty('refuse');
    expect(route(['sudo', 'true'])).toHaveProperty('refuse');
  });

  test('systemctl with a banned flag is refused, not routed to the operator', () => {
    expect(route(['systemctl', 'enable', '--global', '--', 'thing.service'])).toHaveProperty(
      'refuse',
    );
  });

  test('everything else runs as the operator', () => {
    expect(route(['getent', 'passwd', '900'])).toEqual({ as: 'operator' });
  });
});
