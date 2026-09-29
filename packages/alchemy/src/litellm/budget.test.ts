/**
 * `LiteLLM.Budget` through Alchemy's real Plan and Apply over the fake proxy.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, startFakeLitellm } from './fake-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { type BudgetProps, LiteLLMBudget } from './budget.ts';
import { differing, isHardCapUnjustified, toAttributes } from './budget-form.ts';

const KEY = 'sk-test-master';
const stack = (fake: ReturnType<typeof startFakeLitellm>) =>
  fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: BudgetProps, name = 'Tier') =>
  Effect.gen(function* () {
    yield* LiteLLMBudget(name, props);
  });

const tier = {
  budget_id: 'hf-tier-agent',
  budget_duration: '1d',
  created_at: 'x',
  max_budget: 2,
  rpm_limit: '60',
  soft_budget: null,
  tpm_limit: null,
  updated_at: 'x',
};

test('creates a soft-only budget and sends no max_budget', async () => {
  const fake = startFakeLitellm({ masterKey: KEY });
  const planned = await stack(fake).deploy(
    declare({ budgetId: 'hf-tier-x', budgetDuration: '1d', softBudget: 50 }),
  );
  expect(planned).toEqual({ Tier: 'create' });
  expect(fake.budgets()[0]).toMatchObject({ budget_id: 'hf-tier-x', soft_budget: 50 });
  expect(fake.budgets()[0]).not.toHaveProperty('max_budget');
});

test('a second deploy of the same declaration writes nothing', async () => {
  const fake = startFakeLitellm({ masterKey: KEY });
  const props = { budgetId: 'hf-tier-x', softBudget: 50, rpmLimit: 60 };
  const same = stack(fake);
  await same.deploy(declare(props));
  const before = fake.requests().length;
  expect(await same.deploy(declare(props))).toEqual({ Tier: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a hard cap without a reason is refused before any write', async () => {
  const fake = startFakeLitellm({ masterKey: KEY });
  await expect(
    stack(fake).deploy(declare({ budgetId: 'hf-tier-x', maxBudget: 60 })),
  ).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(isHardCapUnjustified({ maxBudget: 1, maxBudgetReason: ' ' })).toBe(true);
  expect(isHardCapUnjustified({ maxBudget: 1, maxBudgetReason: 'abuse guard' })).toBe(false);
});

test('a hard cap with a reason is written', async () => {
  const fake = startFakeLitellm({ masterKey: KEY });
  await stack(fake).deploy(
    declare({ budgetId: 'hf-tier-x', maxBudget: 5, maxBudgetReason: 'public voice endpoint' }),
  );
  expect(fake.budgets()[0]).toMatchObject({ max_budget: 5 });
});

test('a live row is Unowned: refused without --adopt, taken with it', async () => {
  const fake = startFakeLitellm({ masterKey: KEY, budgetSeed: [tier] });
  const props = {
    budgetId: 'hf-tier-agent',
    budgetDuration: '1d',
    maxBudget: 2,
    maxBudgetReason: 'measured live',
  };
  const engine = stack(fake);
  await expect(engine.deploy(declare(props))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  const planned = await engine.deploy(declare({ ...props, rpmLimit: 60 }), { adopt: true });
  expect(Object.values(planned)).toEqual(['adopted']);
});

test('adopting a hard tier and declaring it soft clears max_budget', async () => {
  const fake = startFakeLitellm({ masterKey: KEY, budgetSeed: [tier] });
  await stack(fake).deploy(
    declare({ budgetId: 'hf-tier-agent', budgetDuration: '1d', rpmLimit: 60, softBudget: 2 }),
    { adopt: true },
  );
  expect(fake.budgets()[0]).toMatchObject({ max_budget: null, soft_budget: 2 });
});

test('a proxy that cannot clear a limit fails the apply instead of claiming success', async () => {
  const fake = startFakeLitellm({ masterKey: KEY, budgetSeed: [tier], budgetExcludeNone: true });
  await expect(
    stack(fake).deploy(declare({ budgetId: 'hf-tier-agent', budgetDuration: '1d', rpmLimit: 60 }), {
      adopt: true,
    }),
  ).rejects.toThrow();
});

test('form helpers: string limits become numbers, and differences are named', () => {
  const live = toAttributes(tier);
  expect(live.rpmLimit).toBe(60);
  expect(differing(live, { budgetDuration: '1d', rpmLimit: 60 })).toEqual(['max_budget']);
});
