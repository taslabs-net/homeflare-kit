/**
 * The ceph allowlist, as pure argv checks — no ssh, no fake dial. Every acceptance is a shape
 * ceph-argv.ts's own builders actually produce; every refusal is a shape that would do real damage
 * (a printed key, a cut mon, a de-authenticated cluster) if it ever reached `sudo -n ceph`.
 */
import { describe, expect, test } from 'bun:test';
import {
  CEPH_BIN,
  authCapsArgv,
  authGetArgv,
  authGetOrCreateArgv,
  boundedEntityProblem,
  cephCommandProblem,
  configValueProblem,
  quorumStatusArgv,
} from './ceph-argv.ts';

const ENTITY = 'client.k8s-rbd';
const CAPS = {
  mgr: 'profile rbd pool=k8s-rbd',
  mon: 'profile rbd',
  osd: 'profile rbd pool=k8s-rbd',
};

describe('the allowed shapes, byte-for-byte', () => {
  test('auth get', () => {
    expect(cephCommandProblem(authGetArgv(ENTITY))).toBeUndefined();
    expect(authGetArgv(ENTITY)).toEqual([CEPH_BIN, 'auth', 'get', ENTITY, '-f', 'json']);
  });

  test('auth get-or-create', () => {
    expect(cephCommandProblem(authGetOrCreateArgv(ENTITY, CAPS))).toBeUndefined();
    expect(authGetOrCreateArgv(ENTITY, CAPS)).toEqual([
      CEPH_BIN,
      'auth',
      'get-or-create',
      ENTITY,
      'mon',
      CAPS.mon,
      'osd',
      CAPS.osd,
      'mgr',
      CAPS.mgr,
      '-f',
      'json',
    ]);
  });

  test('auth caps', () => {
    expect(cephCommandProblem(authCapsArgv(ENTITY, CAPS))).toBeUndefined();
  });

  test('quorum_status', () => {
    expect(cephCommandProblem(quorumStatusArgv())).toBeUndefined();
    expect(quorumStatusArgv()).toEqual([CEPH_BIN, 'quorum_status', '-f', 'json']);
  });
});

describe('the entity prefix', () => {
  test('accepts a bounded client.k8s- name', () => {
    expect(boundedEntityProblem('client.k8s-rbd')).toBeUndefined();
    expect(boundedEntityProblem('client.k8s-cephfs')).toBeUndefined();
  });

  test.each([
    ['the cluster admin keyring', 'client.admin'],
    ['a mon keyring', 'mon.a'],
    ['an osd keyring', 'osd.0'],
    ['an mgr keyring', 'mgr.a'],
    ['the PVE storage client', 'client.pve-storage'],
    ['a bare client prefix', 'client.k8s-'],
    ['no client prefix at all', 'k8s-rbd'],
  ])('refuses %s', (_name, entity) => {
    expect(boundedEntityProblem(entity)).toBeString();
    expect(cephCommandProblem(authGetArgv(entity))).toBeString();
  });
});

describe('shell metacharacters never reach the allowlist as data', () => {
  test.each([
    ['in the entity', authGetArgv('client.k8s-rbd; rm -rf /')],
    ['in a cap, backtick', authGetOrCreateArgv(ENTITY, { ...CAPS, osd: 'profile rbd `id`' })],
    ['in a cap, command substitution', authCapsArgv(ENTITY, { ...CAPS, mon: '$(whoami)' })],
    ['in a cap, a pipe', authCapsArgv(ENTITY, { ...CAPS, mgr: 'profile rbd | cat /etc/passwd' })],
    [
      'in a cap, a semicolon',
      authCapsArgv(ENTITY, { ...CAPS, mon: 'profile rbd; ceph auth del client.admin' }),
    ],
  ])('refuses %s', (_name, argv) => {
    expect(cephCommandProblem(argv)).toBeString();
  });
});

describe('K-A4 finding 3: caps are the design’s literal shape, not a general grammar', () => {
  test.each([
    ['plain rwx, no profile at all', 'osd', 'allow rwx'],
    ['a non-rbd profile', 'osd', 'profile osd'],
    ['bootstrap-osd', 'osd', 'profile bootstrap-osd'],
    ['a comma-chained extra grant', 'osd', 'profile rbd pool=k8s-rbd, allow rwx'],
    ['osd rbd with no pool — every pool, VM disks included', 'osd', 'profile rbd'],
    ['mgr rbd with no pool', 'mgr', 'profile rbd'],
    ['mon widened past the plain profile', 'mon', 'profile rbd pool=k8s-rbd'],
  ])('refuses %s (%s cap %j)', (_name, daemon, value) => {
    const caps = { ...CAPS, [daemon]: value };
    expect(cephCommandProblem(authGetOrCreateArgv(ENTITY, caps))).toBeString();
    expect(cephCommandProblem(authCapsArgv(ENTITY, caps))).toBeString();
  });

  test('the design’s own three caps are still accepted', () => {
    expect(cephCommandProblem(authGetOrCreateArgv(ENTITY, CAPS))).toBeUndefined();
  });
});

describe('the never-allowed auth verbs', () => {
  test('auth ls is refused, naming the reason', () => {
    const problem = cephCommandProblem([CEPH_BIN, 'auth', 'ls', '-f', 'json']);
    expect(problem).toContain('prints every key');
  });

  test('auth del is refused, naming lockout safety, for any entity', () => {
    for (const entity of [ENTITY, 'client.admin', 'mon.a']) {
      const problem = cephCommandProblem([CEPH_BIN, 'auth', 'del', entity, '-f', 'json']);
      expect(problem).toContain('never auto-delete');
    }
  });
});

describe('shape mismatches', () => {
  test.each([
    ['bare ceph, no group', [CEPH_BIN]],
    ['an unknown group', [CEPH_BIN, 'status', '-f', 'json']],
    ['auth get with an extra operand', [CEPH_BIN, 'auth', 'get', ENTITY, 'extra', '-f', 'json']],
    ['auth get with an unexpected flag', [CEPH_BIN, 'auth', 'get', ENTITY, '--yes', '-f', 'json']],
    [
      'auth get-or-create missing a daemon',
      [CEPH_BIN, 'auth', 'get-or-create', ENTITY, 'mon', CAPS.mon, '-f', 'json'],
    ],
    [
      'auth caps with daemons out of order',
      [
        CEPH_BIN,
        'auth',
        'caps',
        ENTITY,
        'osd',
        CAPS.osd,
        'mon',
        CAPS.mon,
        'mgr',
        CAPS.mgr,
        '-f',
        'json',
      ],
    ],
    ['missing the -f json suffix', [CEPH_BIN, 'auth', 'get', ENTITY]],
    ['-f without json', [CEPH_BIN, 'auth', 'get', ENTITY, '-f', 'plain']],
    ['a relative ceph, not absolute', ['ceph', 'auth', 'get', ENTITY, '-f', 'json']],
    ['quorum_status with an operand', [CEPH_BIN, 'quorum_status', ENTITY, '-f', 'json']],
  ])('refuses %s', (_name, argv) => {
    expect(cephCommandProblem(argv)).toBeString();
  });
});

describe('config: the named list starts empty, so every shape is refused today', () => {
  test.each([
    ['get', [CEPH_BIN, 'config', 'get', 'global', 'mon_allow_pool_delete', '-f', 'json']],
    ['set', [CEPH_BIN, 'config', 'set', 'global', 'mon_allow_pool_delete', 'true', '-f', 'json']],
    ['rm', [CEPH_BIN, 'config', 'rm', 'global', 'mon_allow_pool_delete', '-f', 'json']],
  ])('config %s is refused: not on the named list', (_verb, argv) => {
    const problem = cephCommandProblem(argv);
    expect(problem).toContain('named option list');
  });

  test('a lockout-class name is refused even if someone tried to add it', () => {
    const problem = cephCommandProblem([
      CEPH_BIN,
      'config',
      'get',
      'mon',
      'mon_host',
      '-f',
      'json',
    ]);
    expect(problem).toContain('lockout-class');
  });

  test('an unbounded `who` is refused', () => {
    const problem = cephCommandProblem([
      CEPH_BIN,
      'config',
      'get',
      'literally anything',
      'x',
      '-f',
      'json',
    ]);
    expect(problem).toBeString();
  });

  test('a config value with a shell metacharacter is refused', () => {
    const argv = [CEPH_BIN, 'config', 'set', 'global', 'x', 'true; rm -rf /', '-f', 'json'];
    expect(cephCommandProblem(argv)).toBeString();
  });
});

describe('K-A4 finding 4: configValueProblem never accepts a flag-shaped value', () => {
  test.each([
    ['a short flag', '-n'],
    ['a file-overwrite flag glued to its argument', '-o/etc/ceph/ceph.conf'],
    ['a long flag with =', '--admin-daemon=/var/run/ceph/ceph-mon.a.asok'],
    ['another long flag', '--conf=/tmp/x'], // tmp-allow: refused argv, not a directory this test creates
    ['the empty string', ''],
    ['a bare dash', '-'],
  ])('refuses %s (%j)', (_name, value) => {
    expect(configValueProblem(value)).toBeString();
  });

  test('a negative integer is still a plain value, not a flag', () => {
    expect(configValueProblem('-42')).toBeUndefined();
  });

  test('an ordinary value is accepted', () => {
    expect(configValueProblem('true')).toBeUndefined();
    expect(configValueProblem('3600')).toBeUndefined();
  });
});
