import { afterEach, describe, expect, test } from 'bun:test';
import { ENV, pathWith, removeBins } from './hooks-harness.ts';
import { cleanFixtures, commit, fixture } from './hooks-secrets-fixture.ts';

afterEach(async () => {
  await cleanFixtures();
  removeBins();
});

describe('pre-push temp literals use the pushed range', () => {
  test.each(['README.md', 'package.json'])(
    'an old literal in an unchanged test does not block a %s change',
    async (file) => {
      const { repo, remote } = await fixture();
      const host = '/tm' + 'p';
      const base = await commit(repo, 'old.test.ts', `const path = '${host}/old';\n`);
      await repo.git('push', '--quiet', 'origin', 'feat');
      const tip = await commit(
        repo,
        file,
        file === 'package.json'
          ? JSON.stringify({ version: '0.0.1', scripts: { check: 'echo CHECK-RAN' } })
          : '# README change\n',
      );

      const result = await repo.hook('pre-push', {
        env: { ...ENV, PATH: await pathWith(0) },
        args: ['origin', remote],
        stdin: `refs/heads/feat ${tip} refs/heads/feat ${base}\n`,
      });

      expect(result.code).toBe(0);
      expect(result.output).toContain('CHECK-RAN');
      expect(result.output).not.toContain('host temp path literal');
    },
  );

  test('a new literal in a changed test fails with its file and line', async () => {
    const { repo, remote } = await fixture();
    const host = '/tm' + 'p';
    const base = await commit(repo, 'changed.test.ts', '// no host paths yet\n');
    await repo.git('push', '--quiet', 'origin', 'feat');
    const tip = await commit(
      repo,
      'changed.test.ts',
      `// added by this push\nconst path = '${host}/new';\n`,
    );

    const result = await repo.hook('pre-push', {
      env: { ...ENV, PATH: await pathWith(0) },
      args: ['origin', remote],
      stdin: `refs/heads/feat ${tip} refs/heads/feat ${base}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain('changed.test.ts:2:');
    expect(result.output).toContain('host temp path literal');
    expect(result.output).not.toContain('CHECK-RAN');
  });
});
