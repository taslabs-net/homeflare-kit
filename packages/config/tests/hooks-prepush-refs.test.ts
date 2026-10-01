/**
 * Which pushed refs the pre-push hook can vouch for, now that one it cannot vouch for FAILS.
 *
 * ★ THE LANES RUN ON THE WORKING TREE, so only a push of the checked-out commit can be
 *   checked (push-range.ts). A ref pointing anywhere else stops the push and names the
 *   checkout that makes it checkable, and the checkout has to be possible: that is why an
 *   annotated tag at `HEAD` — whose sha on git's stdin is the TAG object's, not its commit's —
 *   must count as checked out, or the hook would demand something no checkout can satisfy.
 * ⛔ ONE UNCHECKABLE REF FAILS THE PUSH EVEN ALONGSIDE THE CHECKED-OUT ONE (Tim, 2026-10-01).
 *   Measuring the ref at `HEAD` and merely noting the rest let an unchecked ref ride through
 *   on a checked one. Two refs AT `HEAD` are both checked, so that case must still pass.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { checkoutFix } from '../src/hooks/push-fix.ts';
import { ENV, type Scratch, pathWith, removeBins, scratchRepo } from './hooks-harness.ts';

const ZERO = '0'.repeat(40);

const repo: Scratch = await scratchRepo('hf-push-refs-');
// ⚠️ A gitleaks that finds nothing: pre-push scans what it pushes now, and CI has no gitleaks.
const clean = { ...ENV, PATH: await pathWith(0) };

afterAll(async () => {
  await removeBins();
  await repo.remove();
});

const sha = async (ref: string): Promise<string> => (await repo.git('rev-parse', ref)).trim();

const push = (...lines: string[]) =>
  repo.hook('pre-push', { args: ['nowhere', 'url'], stdin: `${lines.join('\n')}\n`, env: clean });

/** A commit that is not `HEAD`, without moving `HEAD`. */
async function elsewhere(message: string): Promise<string> {
  return (await repo.git('commit-tree', '-p', 'HEAD', '-m', message, 'HEAD^{tree}')).trim();
}

describe('what counts as checked out', () => {
  test('an annotated tag at HEAD is checked: its commit is compared, not the tag object', async () => {
    // Everything committed, `node_modules` ignored: the working tree must be the commit.
    await repo.write('package.json', JSON.stringify({ scripts: { check: 'echo CHECK-RAN' } }));
    await repo.write('.gitignore', 'node_modules\n');
    await repo.git('add', '-A');
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

describe('a mixed push: the checked-out ref together with one that is not', () => {
  test('fails, naming the checked-out ref to push alone and the other to check out', async () => {
    const result = await push(
      `refs/heads/main ${await sha('HEAD')} refs/heads/main ${ZERO}`,
      `refs/heads/other ${await elsewhere('other')} refs/heads/other ${ZERO}`,
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'fix:    push main on its own, then check out other and push from there',
    );
    expect(result.output).not.toContain('CHECK-RAN');
    expect(result.output).not.toContain('--no-verify');
  });

  test('names every ref that is elsewhere, however many', async () => {
    const result = await push(
      `refs/heads/main ${await sha('HEAD')} refs/heads/main ${ZERO}`,
      `refs/heads/a ${await elsewhere('a')} refs/heads/a ${ZERO}`,
      `refs/heads/b ${await elsewhere('b')} refs/heads/b ${ZERO}`,
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'fix:    push main on its own, then check out each of a, b and push it from there',
    );
  });

  test('an annotated tag at HEAD does not excuse a branch that is elsewhere', async () => {
    await repo.git('tag', '-a', 'v2', '-m', 'v2');
    const result = await push(
      `refs/tags/v2 ${await sha('v2')} refs/tags/v2 ${ZERO}`,
      `refs/heads/other ${await elsewhere('other')} refs/heads/other ${ZERO}`,
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      'fix:    push refs/tags/v2 on its own, then check out other and push from there',
    );
  });

  test('two refs that are BOTH the checkout are both checked, so the push passes', async () => {
    // ⚠️ The guard against over-failing: `git push origin HEAD:a HEAD:b`, or `--all` with two
    //   branches at one commit, has two refs and one commit, and nothing is unchecked.
    const result = await push(
      `refs/heads/a ${await sha('HEAD')} refs/heads/a ${ZERO}`,
      `refs/heads/b ${await sha('HEAD')} refs/heads/b ${ZERO}`,
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain('CHECK-RAN');
  });

  test('a deletion alongside the checked-out ref is not a ref to check', async () => {
    const result = await push(
      `refs/heads/main ${await sha('HEAD')} refs/heads/main ${ZERO}`,
      `(delete) ${ZERO} refs/heads/old ${await sha('HEAD')}`,
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain('CHECK-RAN');
  });
});

describe('the fix text', () => {
  // 🔴 Measured by the red team with `git push --mirror`: several refs can be the checkout at
  //   once (a branch, a remote-tracking ref, a tag), and "push a, b, c on its own" read as a slip.
  test('says "on its own" for one ref and "on their own" for several', () => {
    const there = ['refs/heads/other'];
    expect(checkoutFix(there, ['refs/heads/main'])).toBe(
      'push main on its own, then check out other and push from there',
    );
    expect(checkoutFix(there, ['refs/heads/main', 'refs/remotes/origin/det', 'refs/tags/v1'])).toBe(
      'push main, refs/remotes/origin/det and refs/tags/v1 on their own, then check out other and push from there',
    );
    expect(checkoutFix(there, ['refs/heads/a', 'refs/heads/b'])).toBe(
      'push a and b on their own, then check out other and push from there',
    );
  });

  test('is only the checkout when nothing is checked out', () => {
    expect(checkoutFix(['refs/heads/a', 'refs/heads/b'], [])).toBe(
      'check out each of a, b and push it from there, one at a time',
    );
  });
});
