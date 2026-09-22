/**
 * The guard's pure parts, the `id -G` parse, and the real staging code on a real temp directory.
 * Nothing here runs sudo or writes outside `os.tmpdir()`.
 */
import { describe, expect, test } from 'bun:test';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fakeRunner } from './fake-runner.ts';
import type { ExecResult } from './runner.ts';
import { betweenDirs, canRead, operatorGroups } from './sudo-guard.ts';
import { stageFile } from './sudo-stage.ts';

describe('canRead', () => {
  const file = (uid: number, gid: number, mode: number) => ({ gid, mode, uid });
  test.each([
    ['root reads anything', file(0, 0, 0o000), 0, [], true],
    ['the owner gets the owner bits only', file(501, 20, 0o044), 501, [20], false],
    ['a member gets the group bits', file(0, 80, 0o640), 501, [80], true],
    // ⚠️ Exactly one class applies: a member of the group does not fall through to "other".
    ['a member is hidden by 0604', file(0, 80, 0o604), 501, [80], false],
    ['a non-member gets the other bits', file(0, 80, 0o604), 501, [20], true],
    ['0640 hides it from a non-member', file(0, 0, 0o640), 501, [20, 80], false],
    ['0600 root-only hides it', file(0, 0, 0o600), 501, [0], false],
    ['0644 is readable whatever the groups', file(0, 0, 0o644), 501, undefined, true],
    ['0600 is unreadable whatever the groups', file(0, 0, 0o600), 501, undefined, false],
    [
      'only membership could decide, and it is unknown',
      file(0, 80, 0o640),
      501,
      undefined,
      undefined,
    ],
  ] as const)('%s', (_name, f, uid, groups, expected) => {
    expect(canRead(f, uid, groups)).toBe(expected);
  });
});

test('betweenDirs lists every directory strictly between the prefix and the file', () => {
  expect(betweenDirs('/opt/example', '/opt/example/a.conf')).toEqual([]);
  expect(betweenDirs('/opt/example', '/opt/example/app/etc/a.conf')).toEqual([
    '/opt/example/app',
    '/opt/example/app/etc',
  ]);
});

describe('operatorGroups', () => {
  const withId = (result: ExecResult) => {
    const { runner } = fakeRunner();
    const calls: string[][] = [];
    return {
      calls,
      runner: {
        ...runner,
        exec: async (argv: readonly string[]) => (calls.push([...argv]), result),
      },
    };
  };

  test('parses `id -G`, run as the operator with an absolute path', async () => {
    const host = withId({ exitCode: 0, stderr: '', stdout: '20 12 61 80 400 702\n' });
    expect(await operatorGroups(host.runner)).toEqual([20, 12, 61, 80, 400, 702]);
    expect(host.calls).toEqual([['/usr/bin/id', '-G']]);
  });

  test.each([
    ['a failed lookup, whatever it printed', { exitCode: 1, stderr: 'id: failed', stdout: '20\n' }],
    ['empty output', { exitCode: 0, stderr: '', stdout: '\n' }],
    ['anything but numbers', { exitCode: 0, stderr: '', stdout: '20 staff\n' }],
  ])('%s is unknown, never an empty list', async (_name, result) => {
    expect(await operatorGroups(withId(result).runner)).toBeUndefined();
  });
});

describe('stageFile (real temp directory)', () => {
  test('0600 file in a 0700 directory, exact bytes, gone after dispose', async () => {
    const staged = await stageFile(new TextEncoder().encode('listen: 127.0.0.1:9100\n'));
    try {
      expect(await Bun.file(staged.path).text()).toBe('listen: 127.0.0.1:9100\n');
      expect((await stat(staged.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(staged.path))).mode & 0o777).toBe(0o700);
    } finally {
      await staged.dispose();
    }
    // ⚠️ stat, not Bun.file().exists(): measured 2026-09-21 on bun 1.4.0, exists() is false for a
    //   directory that DOES exist, so it could never catch a leaked staging directory.
    await expect(stat(dirname(staged.path))).rejects.toThrow('ENOENT');
  });

  test('two stagings never share a file', async () => {
    const [a, b] = await Promise.all([
      stageFile(new Uint8Array([1])),
      stageFile(new Uint8Array([2])),
    ]);
    try {
      expect(a?.path).not.toBe(b?.path);
    } finally {
      await Promise.all([a?.dispose(), b?.dispose()]);
    }
  });
});
