import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { problemsInTmpLiterals } from '../src/hooks/tmp-literals.ts';
import { scratchRepo } from './hooks-harness.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;

describe('problemsInTmpLiterals', () => {
  test('scans tracked files, excluding an ignored nested checkout and untracked tests', async () => {
    const repo = await scratchRepo('hf-tmp-owned-');
    const host = '/tm' + 'p';
    try {
      await repo.write('.gitignore', 'vendor/\nnode_modules/\n');
      await repo.write('owned test\nname.test.ts', `const path = '${host}/owned';\n`);
      await repo.write('untracked.test.ts', `const path = '${host}/untracked';\n`);
      await repo.write('vendor/clone/foreign.test.ts', `const path = '${host}/foreign';\n`);
      await repo.git('-C', join(repo.dir, 'vendor/clone'), 'init', '--quiet');
      await repo.git('-C', join(repo.dir, 'vendor/clone'), 'add', '.');
      await repo.git('add', '.gitignore', 'owned test\nname.test.ts');

      const problems = await problemsInTmpLiterals(repo.dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('owned test\nname.test.ts:1:');
    } finally {
      await repo.remove();
    }
  });

  test.each(['/private/' + 'tmp', '/var/' + 'tmp'])(
    'catches %s in strings and templates',
    async (host) => {
      const repo = await scratchRepo('hf-tmp-alias-');
      const tick = '`';
      const placeholder = ['$', '{1}'].join('');
      try {
        await repo.write(
          'aliases.test.ts',
          [
            `const single = '${host}/a';`,
            `const double = "${host}";`,
            `const template = ${tick}${host}/b-${placeholder}${tick};`,
            `// ${host}/comment is not a literal`,
            `const allowed = '${host}/fixture'; // tmp-allow: fake path assertion`,
            `const relative = 'not${host}/relative';`,
            `const different = '${host}dir';`,
          ].join('\n'),
        );
        await repo.git('add', 'aliases.test.ts');
        const problems = await problemsInTmpLiterals(repo.dir);
        expect(problems).toHaveLength(3);
        for (const line of [1, 2, 3]) {
          expect(
            problems.some((problem) => problem.startsWith(`aliases.test.ts:${String(line)}:`)),
          ).toBe(true);
        }
      } finally {
        await repo.remove();
      }
    },
  );

  test('flags a host-temp path literal in a test file, and accepts a reason comment', async () => {
    // Built by concatenation so THIS file is not itself a hardcoded host-temp literal.
    const host = '/tm' + 'p';
    const repo = await scratchRepo('hf-tmp-lit-');
    const dir = repo.dir;
    try {
      await writeFile(join(dir, 'bare.test.ts'), `const path = '${host}/bare';\n`);
      await writeFile(
        join(dir, 'allowed.test.ts'),
        `const path = '${host}/socket'; // tmp-allow: postgres peer-auth socket directory\n`,
      );
      await writeFile(
        join(dir, 'above.test.ts'),
        `// tmp-allow: assertion about a fake path, not a directory this test creates\nconst path = "${host}/hf-sudo-1";\n`,
      );
      await writeFile(
        join(dir, 'empty-reason.test.ts'),
        `const path = '${host}/x'; // tmp-allow:\n`,
      );
      await writeFile(
        join(dir, 'comment-only.test.ts'),
        `// the host tmpfs is ${host} when full\n`,
      );
      await writeFile(join(dir, 'not-a-path.test.ts'), "const word = 'not/tmp/here';\n");
      await writeFile(join(dir, 'src.ts'), `const path = '${host}/production';\n`);

      await repo.git('add', '.');
      const problems = await problemsInTmpLiterals(dir);

      expect(problems.some((problem) => problem.includes('bare.test.ts'))).toBe(true);
      expect(problems.some((problem) => problem.includes('empty-reason.test.ts'))).toBe(true);
      expect(problems.some((problem) => problem.includes('allowed.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('above.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('comment-only.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('not-a-path.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('src.ts'))).toBe(false);
    } finally {
      await repo.remove();
    }
  });

  test('a template literal is a path literal too', async () => {
    const host = ['/tm', 'p'].join('');
    const tick = '`';
    const placeholder = ['$', '{1}'].join('');
    const repo = await scratchRepo('hf-tmp-lit-');
    const dir = repo.dir;
    try {
      await writeFile(
        join(dir, 'tpl.test.ts'),
        `const path = ${tick}${host}/tpl-${placeholder}${tick};\n`,
      );
      await repo.git('add', '.');
      expect((await problemsInTmpLiterals(dir)).join('\n')).toContain('tpl.test.ts');
    } finally {
      await repo.remove();
    }
  });

  test('this repo has no unallowlisted host-temp path literal in a test file', async () => {
    expect(await problemsInTmpLiterals(repoRoot)).toEqual([]);
  });
});
