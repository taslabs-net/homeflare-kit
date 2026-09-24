/**
 * `declareRepoPolicy` through Alchemy's own Plan+Apply (repo-apply-order-fake-stack.ts) — the
 * same K5 apply-ordering proof as declare-repo-baseline-apply-order.test.ts, for the OTHER
 * caller of `gateAutoMergeOnRuleset`. See that file's header for why the "turning on" tests
 * deploy twice (K5's own scenario is an update to an already-live repo+ruleset, not a cold
 * create) and for the cold-create limitation this suite also tests explicitly.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { type World, fakeGithubProviders, makeWorld } from './repo-apply-order-fake-providers.ts';
import { fakeStack } from './repo-apply-order-fake-stack.ts';
import { declareRepoPolicy } from './repo-policy.ts';

let world: World;
let stack: ReturnType<typeof fakeStack>;
beforeEach(() => {
  world = makeWorld();
  stack = fakeStack(fakeGithubProviders(world));
});

const declare = (checks: readonly string[]) =>
  declareRepoPolicy('api', { owner: 'taslabs-net', repository: 'api', checks });

const declareOff = () =>
  declareRepoPolicy('api', {
    owner: 'taslabs-net',
    repository: 'api',
    checks: [],
    autoMerge: false,
  });

describe('an existing repo moving from checks: [] to checks: ["ci"]', () => {
  beforeEach(async () => {
    await stack.deploy(declareOff());
    world.calls.length = 0;
  });

  test('the update that turns auto-merge on applies the ruleset before the repository', async () => {
    const planned = await stack.deploy(declare(['ci']));

    expect(planned).toEqual({ api: 'update', 'api-ruleset': 'update' });
    expect(world.calls).toEqual(['ruleset', 'repository']);
    expect(world.repositoryAllowAutoMerge).toBe(true);
  });

  test('a ruleset apply failure leaves allowAutoMerge untouched', async () => {
    world.rulesetShouldFail = true;

    await expect(stack.deploy(declare(['ci']))).rejects.toBeDefined();

    expect(world.calls).toEqual(['ruleset']);
    expect(world.repositoryAllowAutoMerge).toBe(false);
  });
});

describe('auto-merge off (autoMerge: false, no checks)', () => {
  test('declares both with no ordering edge forced between them', async () => {
    const planned = await stack.deploy(declareOff());

    expect(planned).toEqual({ api: 'create', 'api-ruleset': 'create' });
    expect(world.calls.sort()).toEqual(['repository', 'ruleset']);
    expect(world.repositoryAllowAutoMerge).toBe(false);
  });
});

describe('a repo and ruleset created together for the first time, checks from day one', () => {
  test('fails clearly instead of silently fail-open (known, documented limit)', async () => {
    await expect(stack.deploy(declare(['ci']))).rejects.toThrow(/does not exist yet/);

    expect(world.calls).toEqual(['ruleset']);
    expect(world.repositoryAllowAutoMerge).toBeUndefined();
  });
});
