/**
 * ★ The wrapper's CONTENT is the contract. Every repo commits these exact bytes, so a
 *   change here is a change to fourteen repos and must be deliberate enough to fail a
 *   test first.
 */
import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { HOOK_NAMES, HUSKY_HOOK, PREPARE, installHooks, problemsInHooks } from '../src/hooks.ts';
import { ENV, scratchRepo, spawn } from './hooks-harness.ts';

async function scratch(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-hooks-'));
  await Bun.write(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

async function within(manifest: unknown, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await scratch(manifest);
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ADOPTED = { name: 'probe', scripts: { prepare: PREPARE } };

describe('the wrapper', () => {
  test('names the runner by a repo-root-relative path, because git runs hooks there', () => {
    expect(HUSKY_HOOK).toContain('node_modules/@homeflare/config/bin/hooks.ts');
  });

  test('takes the hook name from $0, so both files are byte-identical', () => {
    expect(HUSKY_HOOK).toContain('"$(basename "$0")"');
  });

  test("passes git's arguments through — pre-push needs the remote name", () => {
    // ⚠️ stdin rides along with `exec` untouched; the arguments must be named.
    expect(HUSKY_HOOK).toContain('exec bun "$hook" "$(basename "$0")" "$@"');
  });

  // ⛔ Fails closed — see install.ts. A regression to `exit 0` would let every commit in an
  //   uninstalled worktree through with no checks at all.
  test('exits 1 when the runner is absent, with the fix on one stderr line', () => {
    expect(HUSKY_HOOK).toContain('exit 1');
    expect(HUSKY_HOOK).not.toContain('exit 0');
    expect(HUSKY_HOOK).toContain("run 'bun install' in this worktree");
  });

  test('says it fails closed and offers no way round it', () => {
    expect(HUSKY_HOOK).toContain('fails closed');
    expect(HUSKY_HOOK).not.toContain('--no-verify');
    expect(HUSKY_HOOK).not.toContain('skipping');
  });

  test('prepare activates through the same runner', () => {
    expect(PREPARE).toBe('bun node_modules/@homeflare/config/bin/hooks.ts activate');
  });
});

/**
 * ★ THE WRAPPER, RUN THE WAY GIT RUNS IT: a real commit in a repo whose `core.hooksPath` is
 *   the installed `.husky/`. The string checks above say what the file contains; these say
 *   what it does when the runner is missing, and that it still hands over when it is there.
 */
describe('the installed wrapper, run by git', () => {
  const COMMIT = [
    '-c',
    'user.name=Probe',
    '-c',
    'user.email=probe@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=.husky',
    'commit',
    '--allow-empty',
    '--quiet',
    '-m',
    'x',
  ];

  test('with no runner it exits 1 and the commit does not happen', async () => {
    const repo = await scratchRepo('hf-wrapper-');
    try {
      await rm(join(repo.dir, 'node_modules'), { recursive: true, force: true });
      await installHooks(repo.dir);

      const result = await spawn(['git', '-C', repo.dir, ...COMMIT], repo.dir);
      expect(result.code).not.toBe(0);
      expect(result.output.trim().split('\n')).toHaveLength(1);
      expect(result.output).toContain("run 'bun install' in this worktree");
      expect(await Bun.file(join(repo.dir, '.git/refs/heads/main')).exists()).toBe(false);
    } finally {
      await repo.remove();
    }
  });

  test('run directly it exits 1 with that one line on stderr and nothing on stdout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-wrapper-direct-'));
    try {
      await installHooks(dir);
      const proc = Bun.spawn(['sh', '.husky/pre-push', 'origin', 'url'], {
        cwd: dir,
        env: ENV,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(await proc.exited).toBe(1);
      expect(out).toBe('');
      expect(err.trim().split('\n')).toHaveLength(1);
      expect(err).toContain("run 'bun install' in this worktree");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('with the runner present it hands over, passing the hook name and the arguments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-wrapper-present-'));
    try {
      await installHooks(dir);
      await mkdir(join(dir, 'node_modules/@homeflare/config/bin'), { recursive: true });
      await Bun.write(
        join(dir, 'node_modules/@homeflare/config/bin/hooks.ts'),
        "process.stderr.write('ran ' + process.argv.slice(2).join(' ') + '\\n');\n",
      );
      const env = { ...ENV, PATH: `${dirname(process.execPath)}:${ENV['PATH'] ?? ''}` };
      const result = await spawn(['sh', '.husky/pre-push', 'origin', 'url'], dir, env);
      expect(result.code).toBe(0);
      expect(result.output).toBe('ran pre-push origin url\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('installHooks', () => {
  test('writes both hooks, executable, with identical content', async () => {
    await within({ name: 'probe' }, async (dir) => {
      const written = await installHooks(dir);
      expect(written).toEqual(['.husky/pre-commit', '.husky/pre-push']);

      for (const name of HOOK_NAMES) {
        const path = join(dir, '.husky', name);
        expect(await Bun.file(path).text()).toBe(HUSKY_HOOK);
        expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);
      }
    });
  });
});

describe('problemsInHooks', () => {
  test('reports a project that has adopted nothing', async () => {
    await within({ name: 'probe' }, async (dir) => {
      const problems = await problemsInHooks(dir);
      expect(problems.some((p) => p.includes('"prepare" does not run'))).toBe(true);
      expect(problems.filter((p) => p.includes('missing')).length).toBe(2);
    });
  });

  test('is empty once prepare activates and both wrappers are in place — no husky needed', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      expect(await problemsInHooks(dir)).toEqual([]);
    });
  });

  test('reports husky still in prepare — it re-points core.hooksPath at .husky/_', async () => {
    await within({ scripts: { prepare: `husky && ${PREPARE}` } }, async (dir) => {
      await installHooks(dir);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('still runs husky');
    });
  });

  test('reports a wrapper git would ignore because it is not executable', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      await chmod(join(dir, '.husky/pre-push'), 0o644);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('not executable');
    });
  });

  // ⛔ This is the whole point of owning the text centrally: a repo that edits its copy
  //   is drift, and drift that nothing reports is how fourteen copies happen.
  test('reports an edited wrapper as drift', async () => {
    await within(ADOPTED, async (dir) => {
      await installHooks(dir);
      await Bun.write(join(dir, '.husky/pre-push'), `${HUSKY_HOOK}echo "local tweak"\n`);
      const problems = await problemsInHooks(dir);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('.husky/pre-push');
      expect(problems[0]).toContain('differs');
    });
  });
});
