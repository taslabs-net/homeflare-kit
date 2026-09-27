/**
 * Parsing against fixture stdout — REASONED shapes (ceph-auth-parse.ts's header), so these fixtures
 * are this PR's stand-in for a live cluster, not a measurement.
 */
import { describe, expect, test } from 'bun:test';
import { leaksSliceOf, trailingCommaKeyStdout, unquotedKeyStdout } from './ceph-key-leak-assert.ts';
import { parseAuthGet, parseAuthGetOrCreate, parseQuorumStatus } from './ceph-auth-parse.ts';

const ENTITY = 'client.k8s-rbd';
const CAPS = {
  mgr: 'profile rbd pool=k8s-rbd',
  mon: 'profile rbd',
  osd: 'profile rbd pool=k8s-rbd',
};
const KEYRING_JSON = JSON.stringify([
  { caps: CAPS, entity: ENTITY, key: 'fake-ceph-key-not-a-real-secret' },
]);

describe('parseAuthGet', () => {
  test('present: returns caps only — the parsed value has no key field at all', () => {
    const observed = parseAuthGet({ exitCode: 0, stderr: '', stdout: KEYRING_JSON }, ENTITY);
    expect(observed).toEqual({ caps: CAPS, kind: 'present' });
    expect(Object.keys(observed)).not.toContain('key');
  });

  test('absent: ENOENT in stderr, never mistaken for an error', () => {
    const observed = parseAuthGet(
      { exitCode: 2, stderr: 'Error ENOENT: failed to find client.k8s-rbd in keyring', stdout: '' },
      ENTITY,
    );
    expect(observed).toEqual({ kind: 'absent' });
  });

  test('a nonzero exit without ENOENT propagates as an error, never as absent', () => {
    expect(() =>
      parseAuthGet({ exitCode: 1, stderr: 'Error EACCES: permission denied', stdout: '' }, ENTITY),
    ).toThrow(/EACCES/);
  });

  test('unparseable stdout is an error, never absent', () => {
    expect(() => parseAuthGet({ exitCode: 0, stderr: '', stdout: 'not json' }, ENTITY)).toThrow();
  });

  test('a JSON array with no matching entity is an error', () => {
    const other = JSON.stringify([{ caps: CAPS, entity: 'client.k8s-other', key: 'x' }]);
    expect(() => parseAuthGet({ exitCode: 0, stderr: '', stdout: other }, ENTITY)).toThrow(
      /no matching entry/,
    );
  });

  test('an entry missing a caps field is an error', () => {
    const bad = JSON.stringify([{ entity: ENTITY, key: 'x' }]);
    expect(() => parseAuthGet({ exitCode: 0, stderr: '', stdout: bad }, ENTITY)).toThrow();
  });

  // Decision 65 (LAND finding 5): `auth get` is read unfiltered on every reconcile, so every
  // failure path below feeds it a key-shaped sentinel and proves no 8-character SLICE of it ever
  // reaches the thrown error — not just the whole string. LAND red team (2026-09-26), CONFIRMED:
  // a hyphenated sentinel and a whole-string `.not.toContain` check both missed a real leak where
  // `JSON.parse`'s own error message quoted a prefix of an unquoted or comma-adjacent key
  // (ceph-key-leak-assert.ts has the measured detail).
  test('a malformed present entry never lets even a slice of the key it carried leak', () => {
    const bad = JSON.stringify([{ entity: ENTITY, key: 'sentinel-ceph-key-must-never-leak' }]); // no caps
    let caught: unknown;
    try {
      parseAuthGet({ exitCode: 0, stderr: '', stdout: bad }, ENTITY);
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(leaksSliceOf(String(caught), 'sentinel-ceph-key-must-never-leak')).toBe(false);
  });

  test('a nonzero exit never echoes stdout, even a slice of a key it somehow carried', () => {
    const stdout = unquotedKeyStdout(ENTITY);
    let caught: unknown;
    try {
      parseAuthGet({ exitCode: 13, stderr: 'Error EPERM: refused', stdout }, ENTITY);
    } catch (cause) {
      caught = cause;
    }
    expect(String(caught)).toContain('EPERM');
    expect(leaksSliceOf(String(caught))).toBe(false);
  });

  for (const [shape, stdout] of [
    ['a bare (unquoted) key token', unquotedKeyStdout(ENTITY)],
    ['a trailing comma after the entry', trailingCommaKeyStdout(ENTITY)],
  ] as const) {
    test(`unparseable stdout via ${shape} never leaks a slice of the key, from parseAuthGet`, () => {
      let caught: unknown;
      try {
        parseAuthGet({ exitCode: 0, stderr: '', stdout }, ENTITY);
      } catch (cause) {
        caught = cause;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(leaksSliceOf(String(caught))).toBe(false);
    });

    test(`unparseable stdout via ${shape} never leaks a slice of the key, from parseAuthGetOrCreate`, () => {
      let caught: unknown;
      try {
        parseAuthGetOrCreate({ exitCode: 0, stderr: '', stdout }, ENTITY);
      } catch (cause) {
        caught = cause;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(leaksSliceOf(String(caught))).toBe(false);
    });
  }
});

describe('parseAuthGetOrCreate', () => {
  test('returns caps and the key, on success', () => {
    const created = parseAuthGetOrCreate({ exitCode: 0, stderr: '', stdout: KEYRING_JSON }, ENTITY);
    expect(created).toEqual({ caps: CAPS, key: 'fake-ceph-key-not-a-real-secret' });
  });

  test('never reads a nonzero exit as absent — always an error', () => {
    expect(() =>
      parseAuthGetOrCreate(
        { exitCode: 22, stderr: 'Error EINVAL: caps do not match', stdout: '' },
        ENTITY,
      ),
    ).toThrow(/EINVAL/);
  });
});

describe('parseQuorumStatus', () => {
  test('healthy: a non-empty quorum array', () => {
    expect(parseQuorumStatus('{"quorum":[0,1,2],"quorum_names":["a","b","c"]}')).toEqual({
      healthy: true,
    });
  });

  test('degraded: an empty quorum array', () => {
    expect(parseQuorumStatus('{"quorum":[]}')).toEqual({
      healthy: false,
      reason: 'no non-empty `quorum` array in the quorum_status output',
    });
  });

  test('degraded: no quorum field at all', () => {
    expect(parseQuorumStatus('{"election_epoch":5}').healthy).toBe(false);
  });

  test('degraded: not even a JSON object', () => {
    expect(parseQuorumStatus('[1,2,3]').healthy).toBe(false);
  });

  test('degraded, never thrown: unparseable JSON fails closed instead of crashing the caller', () => {
    expect(parseQuorumStatus('not json').healthy).toBe(false);
  });
});
