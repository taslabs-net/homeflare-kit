/**
 * `declareRepoBaseline` through Alchemy's own Plan+Apply (repo-apply-order-fake-stack.ts) — not
 * the pure form functions — proving the K5 apply-ordering fix (repo-auto-merge-gate.ts) actually
 * changes what the ENGINE schedules, the same reasoning `litellm/pass-through-endpoint-replace.
 * test.ts`'s header gives for driving the engine instead of asserting a `diff` answer.
 *
 * ★ THE "TURNING ON" TESTS DEPLOY TWICE, ON PURPOSE. K5's own scenario is literally "a repo
 *   MOVES from checks:[] to checks:['x']" — an UPDATE to an already-live repo and ruleset, not a
 *   cold create. A first version of this file proved the ordering fix with a single deploy from
 *   empty state instead (an ADVERSARIAL REVIEW, 2026-09-24, caught this: that single-deploy
 *   shape is a cold create, and the fake ruleset provider back then had no notion that a real
 *   ruleset create 404s against a repository that does not exist yet — so the test could not
 *   have caught the ordering fix forcing exactly that impossible order on a genuine cold create).
 *   Deploying `checks: []` first, then `checks: ['ci']`, makes both resources already live by
 *   the time the gate kicks in — the actual K5 shape, and no longer a cold create.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { declareRepoBaseline } from './declare-repo-baseline.ts';
import { type World, fakeGithubProviders, makeWorld } from './repo-apply-order-fake-providers.ts';
import { fakeStack } from './repo-apply-order-fake-stack.ts';

let world: World;
let stack: ReturnType<typeof fakeStack>;
beforeEach(() => {
  world = makeWorld();
  stack = fakeStack(fakeGithubProviders(world));
});

const declare = (checks: readonly string[]) =>
  declareRepoBaseline('acme', {
    owner: 'taslabs-net',
    repository: 'acme',
    checks,
    visibility: 'private',
  });

describe('an existing repo moving from checks: [] to checks: ["ci"]', () => {
  beforeEach(async () => {
    // Establish both as already-live, exactly like a repo baselined with no checks yet.
    await stack.deploy(declare([]));
    world.calls.length = 0;
  });

  test('the update that turns auto-merge on applies the ruleset before the repository', async () => {
    const planned = await stack.deploy(declare(['ci']));

    expect(planned).toEqual({ acme: 'update', 'acme-ruleset': 'update' });
    expect(world.calls).toEqual(['ruleset', 'repository']);
    // The value sent is still exactly `true` — only the ordering changed.
    expect(world.repositoryAllowAutoMerge).toBe(true);
  });

  test('a ruleset apply failure leaves allowAutoMerge untouched', async () => {
    world.rulesetShouldFail = true;

    await expect(stack.deploy(declare(['ci']))).rejects.toBeDefined();

    // The repository's `reconcile` never ran at all — blocked on the ruleset's Output, which
    // never resolved — so `allowAutoMerge` was never even sent, let alone turned on with no
    // required check live. It is still `false` from the first deploy above.
    expect(world.calls).toEqual(['ruleset']);
    expect(world.repositoryAllowAutoMerge).toBe(false);
  });
});

describe('auto-merge already/staying off (checks: [])', () => {
  test('declares both with no ordering edge forced between them', async () => {
    const planned = await stack.deploy(declare([]));

    expect(planned).toEqual({ acme: 'create', 'acme-ruleset': 'create' });
    expect(world.calls.sort()).toEqual(['repository', 'ruleset']);
    // `allowAutoMerge` was sent as a plain `false`, never gated on the ruleset.
    expect(world.repositoryAllowAutoMerge).toBe(false);
  });
});

describe('a repo and ruleset created together for the first time, checks from day one', () => {
  test('fails clearly instead of silently fail-open (known, documented limit — see file header)', async () => {
    await expect(stack.deploy(declare(['ci']))).rejects.toThrow(/does not exist yet/);

    // The ruleset's own create is what refuses — never the repository's, and never a state
    // where allowAutoMerge went live with nothing to wait on.
    expect(world.calls).toEqual(['ruleset']);
    expect(world.repositoryAllowAutoMerge).toBeUndefined();
  });
});
