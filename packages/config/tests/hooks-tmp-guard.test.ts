/**
 * The pre-push test lane's temp directory: TMPDIR is a fresh directory, leftovers fail
 * the lane by prefix, and a hardcoded "/tmp" path is reported because it never lands there.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { leakPrefixes, problemsInTmpLiterals, runInTmp } from '../src/hooks/tmp-guard.ts';
import { scratchRepo } from './hooks-harness.ts';

const repoRoot = new URL('../../../', import.meta.url).pathname;

describe('leakPrefixes', () => {
  test('groups mkdtemp names by the template prefix and counts them', () => {
    expect(
      leakPrefixes(['enables-cfg-AbCdEf', 'enables-app-MnOpQr', 'enables-cfg-GhIjKl']),
    ).toEqual([
      { prefix: 'enables-cfg-', count: 2 },
      { prefix: 'enables-app-', count: 1 },
    ]);
  });

  test('keeps the dot of a mktemp XXXXXX template', () => {
    expect(leakPrefixes(['cfcode-c8.2tMWsY', 'cfcode-c8.3T56MD'])).toEqual([
      { prefix: 'cfcode-c8.', count: 2 },
    ]);
  });

  test('a name with no random suffix is its own prefix', () => {
    expect(leakPrefixes(['leftover'])).toEqual([{ prefix: 'leftover', count: 1 }]);
  });
});

describe('runInTmp', () => {
  test('lists leftover directories by prefix and removes the guard directory', async () => {
    const { code, leaks, removed } = await runInTmp(
      'mkdir "$TMPDIR/enables-cfg-AbCdEf" "$TMPDIR/enables-cfg-GhIjKl"',
      process.cwd(),
    );

    expect(code).toBe(0);
    expect(leaks).toEqual([{ prefix: 'enables-cfg-', count: 2 }]);
    expect(existsSync(removed)).toBe(false);
  });

  test('a lane that removes what it creates leaves nothing, and the guard directory is gone', async () => {
    const { code, leaks, removed } = await runInTmp(
      'd=$(mktemp -d "$TMPDIR/gone.XXXXXX"); rm -rf "$d"',
      process.cwd(),
    );

    expect(code).toBe(0);
    expect(leaks).toEqual([]);
    expect(existsSync(removed)).toBe(false);
  });

  test('a failing lane still reports leftovers, and the guard directory is still removed', async () => {
    const { code, leaks, removed } = await runInTmp(
      'mkdir "$TMPDIR/still-AbCdEf"; exit 4',
      process.cwd(),
    );

    expect(code).toBe(4);
    expect(leaks).toEqual([{ prefix: 'still-', count: 1 }]);
    expect(existsSync(removed)).toBe(false);
  });

  test('Bun os.tmpdir and mkdtemp land inside the guard directory', async () => {
    // ★ bun 1.4.0 src/js/node/os.ts: POSIX tmpdir() is TMPDIR, then TMP, then TEMP, then /tmp.
    //   fs.mkdtemp appends six characters to the prefix the caller passes; it does not read
    //   TMPDIR itself. join(tmpdir(), template) is what puts the directory under the guard.
    const { code, leaks } = await runInTmp(
      'bun -e \'import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; const dir = mkdtempSync(join(tmpdir(), "seen-")); if (!dir.startsWith(process.env.TMPDIR + "/")) process.exit(2)\'',
      process.cwd(),
    );

    expect(code).toBe(0);
    expect(leaks).toEqual([{ prefix: 'seen-', count: 1 }]);
  });

  test('a directory created at the host temp path is invisible to the guard', async () => {
    // tmp-allow: this test creates a hardcoded host temp directory to prove the guard cannot see it
    const escaped = `/tmp/hf-tmp-escape-${Bun.randomUUIDv7()}`;
    try {
      const { leaks } = await runInTmp(
        `mkdir ${escaped} && mkdir "$TMPDIR/inside-AbCdEf"`,
        process.cwd(),
      );
      expect(leaks).toEqual([{ prefix: 'inside-', count: 1 }]);
      expect(existsSync(escaped)).toBe(true);
    } finally {
      await rm(escaped, { recursive: true, force: true });
    }
  });
});

describe('problemsInTmpLiterals', () => {
  test('flags a host-temp path literal in a test file, and accepts a reason comment', async () => {
    // Built by concatenation so THIS file is not itself a hardcoded host-temp literal.
    const host = '/tm' + 'p';
    const dir = await mkdtemp(join(tmpdir(), 'hf-tmp-lit-'));
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

      const problems = await problemsInTmpLiterals(dir);

      expect(problems.some((problem) => problem.includes('bare.test.ts'))).toBe(true);
      expect(problems.some((problem) => problem.includes('empty-reason.test.ts'))).toBe(true);
      expect(problems.some((problem) => problem.includes('allowed.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('above.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('comment-only.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('not-a-path.test.ts'))).toBe(false);
      expect(problems.some((problem) => problem.includes('src.ts'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a template literal is a path literal too', async () => {
    const host = ['/tm', 'p'].join('');
    const tick = '`';
    const placeholder = ['$', '{1}'].join('');
    const dir = await mkdtemp(join(tmpdir(), 'hf-tmp-lit-'));
    try {
      await writeFile(
        join(dir, 'tpl.test.ts'),
        `const path = ${tick}${host}/tpl-${placeholder}${tick};\n`,
      );
      expect((await problemsInTmpLiterals(dir)).join('\n')).toContain('tpl.test.ts');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('this repo has no unallowlisted host-temp path literal in a test file', async () => {
    expect(await problemsInTmpLiterals(repoRoot)).toEqual([]);
  });
});

describe('pre-push', () => {
  test('a test lane that leaks fails the push and names the prefix', async () => {
    const repo = await scratchRepo('hf-tmp-push-');
    try {
      await repo.write(
        'package.json',
        JSON.stringify({ name: 'probe', private: true, scripts: { check: 'bun test' } }),
      );
      await repo.write(
        'leak.test.ts',
        [
          "import { mkdtempSync } from 'node:fs';",
          "import { tmpdir } from 'node:os';",
          "import { join } from 'node:path';",
          "import { test } from 'bun:test';",
          "test('leaks', () => { mkdtempSync(join(tmpdir(), 'leak-demo-')); });",
          '',
        ].join('\n'),
      );
      await repo.git('add', '.');
      await repo.git('commit', '--quiet', '-m', 'seed');
      const tip = (await repo.git('rev-parse', 'HEAD')).trim();
      const result = await repo.hook('pre-push', {
        args: ['nowhere', 'https://example.invalid/git'],
        stdin: `refs/heads/main ${tip} refs/heads/main ${'0'.repeat(40)}\n`,
      });

      expect(result.code).toBe(1);
      expect(result.output).toContain('leak-demo-');
    } finally {
      await repo.remove();
    }
  });
});
