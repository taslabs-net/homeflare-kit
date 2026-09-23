/**
 * The drift check fails on a hand-edited file, passes after a refresh, passes for a
 * declared exception, and fails for an undeclared one.
 *
 * ★ EVERY TEST HERE WRITES A REAL DIRECTORY AND READS IT BACK. The thing being asserted is
 *   "a committed file differs from the render", which a mocked filesystem cannot be wrong
 *   about in the way a real one can — a path joined wrongly, a file that is missing rather
 *   than different, a CRLF checkout.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  type RepoShape,
  driftInRepoShape,
  except,
  exceptionSummary,
  refreshRepoShape,
  renderRepoShape,
  repoShapeCli,
} from '../src/repo-shape.ts';

const SHAPE: RepoShape = {
  owner: 'taslabs-net',
  publishes: false,
  repository: 'homeflare-proxmox',
  runner: 'mini',
};

/**
 * ★ COUNTED FROM THE RENDER, NOT WRITTEN AS A NUMBER. These asserted a literal 5 until the
 *   auto-merge workflow made it 6; a count that tracks the renderer is the one that says
 *   "every rendered file" rather than "the files there were on the day this was written".
 */
const RENDERED = Object.keys(renderRepoShape(SHAPE).files).length;

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = `${tmpdir()}/repo-shape-${crypto.randomUUID()}`;
  made.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('an empty repository', () => {
  test('is reported as missing every rendered file, with the command to fix it', async () => {
    const dir = await scratch();
    const report = await driftInRepoShape(dir, SHAPE);
    expect(report.problems).toHaveLength(RENDERED);
    expect(report.problems.every((problem) => problem.includes('bun run repo-shape:refresh'))).toBe(
      true,
    );
  });
});

describe('refresh then check', () => {
  test('a refreshed repository has no drift', async () => {
    const dir = await scratch();
    const result = await refreshRepoShape(dir, SHAPE);
    expect(result.written).toHaveLength(RENDERED);
    expect((await driftInRepoShape(dir, SHAPE)).problems).toEqual([]);
  });

  test('a second refresh writes nothing', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    const again = await refreshRepoShape(dir, SHAPE);
    expect(again.written).toEqual([]);
    expect(again.unchanged).toHaveLength(RENDERED);
  });
});

describe('a hand-edited file', () => {
  test('fails the check, naming the file and both ways out', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    const path = `${dir}/.github/workflows/ci.yml`;
    await Bun.write(
      path,
      (await Bun.file(path).text()).replace('bun run check', 'bun run check --quiet'),
    );

    const report = await driftInRepoShape(dir, SHAPE);
    expect(report.drifted).toEqual(['.github/workflows/ci.yml']);
    expect(report.problems[0]).toContain('differs from what @homeflare/config renders');
    expect(report.problems[0]).toContain('bun run repo-shape:refresh');
    expect(report.problems[0]).toContain('except(');
  });

  test('passes again after a refresh puts the standard back', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    await Bun.write(`${dir}/.github/workflows/security.yml`, '# hand written\n');
    expect((await driftInRepoShape(dir, SHAPE)).problems).toHaveLength(1);

    await refreshRepoShape(dir, SHAPE);
    expect((await driftInRepoShape(dir, SHAPE)).problems).toEqual([]);
  });

  test('a CRLF checkout is not drift', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    const path = `${dir}/.github/dependabot.yml`;
    await Bun.write(path, (await Bun.file(path).text()).replaceAll('\n', '\r\n'));
    expect((await driftInRepoShape(dir, SHAPE)).problems).toEqual([]);
  });
});

describe('exceptions', () => {
  const excepted: RepoShape = {
    ...SHAPE,
    exceptions: [
      except({
        file: '.github/workflows/ci.yml',
        reason: 'Payload needs Node >=24.15, which the rendered job does not install',
        since: '2026-09-22',
      }),
    ],
  };

  test('a declared exception passes even though the file differs', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    await Bun.write(`${dir}/.github/workflows/ci.yml`, '# this repository owns this file\n');
    expect((await driftInRepoShape(dir, excepted)).problems).toEqual([]);
  });

  test('an undeclared one, in the same repository, still fails', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    await Bun.write(`${dir}/.github/workflows/ci.yml`, '# owned\n');
    await Bun.write(`${dir}/.github/workflows/security.yml`, '# not declared\n');
    const report = await driftInRepoShape(dir, excepted);
    expect(report.drifted).toEqual(['.github/workflows/security.yml']);
  });

  test('a refresh never overwrites an excepted file', async () => {
    const dir = await scratch();
    await refreshRepoShape(dir, SHAPE);
    await Bun.write(`${dir}/.github/workflows/ci.yml`, '# owned\n');
    const result = await refreshRepoShape(dir, excepted);
    expect(result.skipped).toEqual(['.github/workflows/ci.yml']);
    expect(await Bun.file(`${dir}/.github/workflows/ci.yml`).text()).toBe('# owned\n');
  });

  test('an exception for a file this shape does not render is itself reported', async () => {
    const dir = await scratch();
    const stale: RepoShape = {
      ...SHAPE,
      runner: 'github',
      exceptions: [
        except({
          file: '.github/actionlint.yaml',
          reason: 'left over from when this repository ran on the mini runner',
          since: '2026-09-22',
        }),
      ],
    };
    await refreshRepoShape(dir, stale);
    const report = await driftInRepoShape(dir, stale);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('renders no such file');
  });

  test('one file excepted twice is refused, because one reason would never be read', async () => {
    const dir = await scratch();
    const twice: RepoShape = {
      ...SHAPE,
      exceptions: [
        except({
          file: '.github/dependabot.yml',
          reason: 'updates are taken by hand here',
          since: '2026-09-22',
        }),
        except({
          file: '.github/dependabot.yml',
          reason: 'a second, different reason nobody sees',
          since: '2026-09-22',
        }),
      ],
    };
    await refreshRepoShape(dir, twice);
    expect((await driftInRepoShape(dir, twice)).problems[0]).toContain('more than once');
  });

  test('the summary names what was not checked, so it stays visible', () => {
    expect(exceptionSummary(excepted)[0]).toContain('Payload needs Node >=24.15');
  });
});

describe('a reason is enforced at runtime as well as in the type', () => {
  test('whitespace is not a reason', () => {
    expect(() =>
      except({ file: '.github/dependabot.yml', reason: '            ', since: '2026-09-22' }),
    ).toThrow(/must be a sentence/);
  });

  test('a `since` that is not a date is refused', () => {
    expect(() =>
      except({
        file: '.github/dependabot.yml',
        reason: 'updates are taken by hand here',
        since: 'last tuesday',
      }),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe('the CLI', () => {
  test('--check exits non-zero on drift and zero when in step', async () => {
    const dir = await scratch();
    expect(await repoShapeCli(dir, SHAPE, ['--check'])).toBe(1);
    await refreshRepoShape(dir, SHAPE);
    expect(await repoShapeCli(dir, SHAPE, ['--check'])).toBe(0);
  });
});
