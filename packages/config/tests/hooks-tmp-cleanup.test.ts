import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { describe, expect, spyOn, test } from 'bun:test';
import { runInTmp } from '../src/hooks/tmp-guard.ts';

describe('temp guard cleanup errors', () => {
  // ★ Inject the filesystem failure: chmod-based tests silently stop testing EACCES as root.
  test.each([0, 4])(
    'reports a removal failure and preserves exit %i and leak evidence',
    async (code) => {
      let dir: string | undefined;
      const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const result = await runInTmp(
          `mkdir "$TMPDIR/leaked-AbCdEf"; exit ${String(code)}`,
          process.cwd(),
          async (path) => {
            dir = String(path);
            throw new Error('EACCES: simulated removal failure');
          },
        );
        expect(result.code).toBe(code);
        expect(result.leaks).toEqual([{ prefix: 'leaked-', count: 1 }]);
        expect(result.cleanupError).toContain('EACCES');
        expect(stderr.mock.calls.flat().join('')).toContain('could not remove temp guard');
        expect(stderr.mock.calls.flat().join('')).toContain(result.removed);
        expect(existsSync(result.removed)).toBe(true);
      } finally {
        stderr.mockRestore();
        if (dir !== undefined) await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test('cleanup failure preserves an original spawn exception', async () => {
    let dir: string | undefined;
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(
        runInTmp('exit 0', `${process.cwd()}/missing-${Bun.randomUUIDv7()}`, async (path) => {
          dir = String(path);
          throw new Error('cleanup must not replace the spawn error');
        }),
      ).rejects.toThrow('ENOENT');
      expect(stderr.mock.calls.flat().join('')).toContain('could not remove temp guard');
    } finally {
      stderr.mockRestore();
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    }
  });
});
