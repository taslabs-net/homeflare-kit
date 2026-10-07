import { describe, expect, spyOn, test } from 'bun:test';
import { runPlannedLanes } from '../src/hooks/push-run.ts';
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
