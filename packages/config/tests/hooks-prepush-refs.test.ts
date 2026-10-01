/**
 * Which pushed refs the pre-push hook can vouch for, now that one it cannot vouch for FAILS.
 *
 * ★ THE LANES RUN ON THE WORKING TREE, so only a push of the checked-out commit can be
 *   checked (push-range.ts). A ref pointing anywhere else stops the push and names the
 *   checkout that makes it checkable, and the checkout has to be possible: that is why an
 *   annotated tag at `HEAD` — whose sha on git's stdin is the TAG object's, not its commit's —
 *   must count as checked out, or the hook would demand something no checkout can satisfy.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { type Scratch, scratchRepo } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);

const repo: Scratch = await scratchRepo('hf-push-refs-');

afterAll(async () => {
  await repo.remove();
});

const sha = async (ref: string): Promise<string> => (await repo.git('rev-parse', ref)).trim();

const push = (...lines: string[]) =>
  repo.hook('pre-push', { args: ['nowhere', 'url'], stdin: `${lines.join('\n')}\n` });

/** A commit that is not `HEAD`, without moving `HEAD`. */
async function elsewhere(message: string): Promise<string> {
  return (await repo.git('commit-tree', '-p', 'HEAD', '-m', message, 'HEAD^{tree}')).trim();
}

describe('what counts as checked out', () => {
  test('an annotated tag at HEAD is checked: its commit is compared, not the tag object', async () => {
    await repo.write('package.json', JSON.stringify({ scripts: { check: 'echo CHECK-RAN' } }));
    await repo.git('add', 'package.json');
    await repo.git('commit', '--quiet', '-m', 'seed');
    await repo.git('tag', '-a', 'v1', '-m', 'v1');

    // 🔴 The premise: git hands the hook the TAG's sha, which is not HEAD's.
    expect(await sha('v1')).not.toBe(await sha('HEAD'));
    const result = await push(`refs/tags/v1 ${await sha('v1')} refs/tags/v1 ${ZERO}`);

    expect(result.code).toBe(0);
    expect(result.output).toContain('CHECK-RAN');
    expect(result.output).not.toContain('not what is being pushed');
  });

  test('an annotated tag elsewhere fails, naming a ref the checkout can reach', async () => {
    const first = await sha('HEAD');
    await repo.git('tag', '-a', 'old', '-m', 'old', first);
    await repo.write('later.txt', 'later\n');
    await repo.git('add', 'later.txt');
    await repo.git('commit', '--quiet', '-m', 'later');

    const result = await push(`refs/tags/old ${await sha('old')} refs/tags/old ${ZERO}`);

    expect(result.code).toBe(1);
    expect(result.output).toContain('fix:    check out refs/tags/old and push from there');
    expect(result.output).not.toContain('CHECK-RAN');
  });
});

describe('several refs, none checked out', () => {
  test('fails once, naming every one of them', async () => {
    const result = await push(
      `refs/heads/a ${await elsewhere('a')} refs/heads/a ${ZERO}`,
      `refs/heads/b ${await elsewhere('b')} refs/heads/b ${ZERO}`,
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain('fix:    check out each of a, b and push it from there');
    expect(result.output).not.toContain('CHECK-RAN');
  });
});
