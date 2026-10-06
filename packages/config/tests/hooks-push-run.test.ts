import { describe, expect, spyOn, test } from 'bun:test';
import { runPlannedLanes } from '../src/hooks/push-run.ts';
import { withReadTests } from '../src/hooks/read-tests.ts';
import * as guard from '../src/hooks/tmp-guard.ts';

describe('pre-push test lane failure messages', () => {
  const cleanupError = 'could not remove temp guard fixture-dir: EACCES';
  const cases = [
    {
      name: 'failed tests',
      code: 4,
      leaks: [],
      why: '`tests` failed',
      fix: 'tests — until it is green',
    },
    {
      name: 'leaks after passing tests',
      code: 0,
      leaks: [{ prefix: 'fixture-', count: 2 }],
      why: '`tests` left temp entries\n  fixture- 2',
      fix: 'remove every temp directory the test lane creates',
    },
    {
      name: 'failed tests and leaks',
      code: 4,
      leaks: [{ prefix: 'fixture-', count: 2 }],
      why: '`tests` failed and left temp entries\n  fixture- 2',
      fix: 'remove every temp directory the test lane creates',
    },
    {
      name: 'cleanup failure after passing tests without leaks',
      code: 0,
      leaks: [],
      cleanupError,
      why: '`tests` passed, but removing its temp directory failed',
      fix: 'resolve the temp directory removal error above',
    },
  ];

  test.each(cases)('$name', async ({ code, leaks, cleanupError, why, fix }) => {
    // ★ Inject the guard result so cleanup failure is deterministic even when run as root.
    const guarded = spyOn(guard, 'runInTmp').mockResolvedValue({
      code,
      leaks,
      removed: 'fixture-dir',
      ...(cleanupError === undefined ? {} : { cleanupError }),
    });
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stopped = new Error('hook stopped');
    const exit = spyOn(process, 'exit').mockImplementation(() => {
      throw stopped;
    });
    try {
      await expect(
        runPlannedLanes(
          process.cwd(),
          [{ kind: 'test', label: 'tests', command: 'bun test', scoped: false }],
          [],
        ),
      ).rejects.toBe(stopped);
      expect(exit).toHaveBeenCalledWith(1);
      const detail = cleanupError === undefined ? why : `${why}\n  ${cleanupError}`;
      expect(stderr.mock.calls.flat().join('')).toBe(
        `  run  tests  (IN FULL)\n\n✗ pre-push: ${detail}\n  fix:    ${fix}\n\n`,
      );
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
      guarded.mockRestore();
    }
  });
});

test('a selected name containing a newline is never logged', async () => {
  const name = 'tests/has\nnewline.test.ts';
  const planned = withReadTests(
    [{ kind: 'test', label: 'bun test', command: 'bun test --changed=abc', scoped: true }],
    [name],
  );
  const lane = planned.lanes[0];
  if (lane === undefined || lane.kind !== 'test') throw new Error('expected a test lane');
  expect(lane.command).toContain(name);
  expect(lane.selected).toBe(1);

  const guarded = spyOn(guard, 'runInTmp').mockResolvedValue({
    code: 1,
    leaks: [],
    removed: 'fixture-dir',
  });
  const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stopped = new Error('hook stopped');
  const exit = spyOn(process, 'exit').mockImplementation(() => {
    throw stopped;
  });
  try {
    await expect(runPlannedLanes(process.cwd(), planned.lanes, [])).rejects.toBe(stopped);
    const logged = stderr.mock.calls.flat().join('');
    expect(logged).not.toContain(name);
    expect(logged).not.toContain('newline.test.ts');
    expect(logged).toContain('1 selected');
    expect(logged).toContain('bun test (1 selected) — until it is green');
  } finally {
    exit.mockRestore();
    stderr.mockRestore();
    guarded.mockRestore();
  }
});
