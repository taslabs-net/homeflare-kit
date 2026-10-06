/**
 * `LiteLLM.Key` through Alchemy's real Plan and Apply over the fake proxy: create, no-op, adopt by
 * alias, update, and the bind to a `LiteLLM.Budget`. Secret handling is key-secret.test.ts; delete
 * and read failures are key-delete.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { LiteLLMBudget } from './budget.ts';
import { writesOf } from './fake-stack.ts';
import { LiteLLMKey } from './key.ts';
import { differing, toAttributes, updateBody } from './key-form.ts';
import {
  FAKE_KEY,
  VAR,
  declare,
  failureOf,
  keyStack,
  liveRow,
  newFake,
  withEnv,
} from './key-harness.ts';

const tier = (id: string) => ({ budget_id: id, created_at: 'x', updated_at: 'x' });
const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a' } as const;
const deploy = (stack: ReturnType<typeof keyStack>, props: Parameters<typeof declare>[0]) =>
  withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare(props)));
const paths = (fake: ReturnType<typeof newFake>) => fake.keys.writes().map((write) => write.path);

describe('create', () => {
  test('makes the key with every declared setting and sends the value once', async () => {
    const fake = newFake({ budgetSeed: [tier('hf-tier-agent')] });
    const props = {
      ...seat,
      allowedRoutes: ['/chat/completions'],
      budgetId: 'hf-tier-agent',
      metadata: { seat: 'a' },
      models: ['glm-5.3', 'gpt-oss-120b'],
      teamId: 'team-cf',
    };
    expect(await deploy(keyStack(fake), props)).toEqual({ Seat: 'create' });
    expect(fake.keys.rows()).toMatchObject([
      {
        allowed_routes: ['/chat/completions'],
        budget_id: 'hf-tier-agent',
        expires: null,
        key_alias: 'seat-a',
        metadata: { seat: 'a' },
        models: ['glm-5.3', 'gpt-oss-120b'],
        team_id: 'team-cf',
      },
    ]);
    expect(fake.keys.received()).toEqual([FAKE_KEY]);
  });

  test('a second deploy of the same declaration writes nothing', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await deploy(stack, { ...seat, models: ['glm-5.3'] });
    const before = fake.requests().length;
    expect(await deploy(stack, { ...seat, models: ['glm-5.3'] })).toEqual({ Seat: 'noop' });
    expect(writesOf(fake.requests().slice(before))).toEqual([]);
  });

  test('binds to a Budget declared beside it: the tier is created first', async () => {
    const fake = newFake();
    const planned = await withEnv({ [VAR]: FAKE_KEY }, () =>
      keyStack(fake).deploy(
        Effect.gen(function* () {
          const tierRow = yield* LiteLLMBudget('Tier', { budgetId: 'hf-tier-x', softBudget: 5 });
          // ★ AN OUTPUT IN A PROP IS A DEPENDENCY EDGE: the fake 400s a key whose `budget_id` is not
          //   a live budget, so this only succeeds if the Budget was written first.
          yield* LiteLLMKey('Seat', { ...seat, budgetId: tierRow.budgetId });
        }),
      ),
    );
    expect(planned).toEqual({ Seat: 'create', Tier: 'create' });
    expect(writesOf(fake.requests())).toEqual(['POST /budget/new', 'POST /key/generate']);
    expect(fake.keys.rows()[0]).toMatchObject({ budget_id: 'hf-tier-x' });
  });
});

describe('adopt by alias', () => {
  const live = liveRow({ budget_id: 'hf-tier-agent', models: ['old-model'] });
  // ★ `budgetId: null` IS DECLARED: an omitted prop is left alone (key-scope.test.ts), so unbinding
  //   the live tier takes a declaration.
  const declared = { budgetId: null, keyAlias: 'seat-a', models: ['glm-5.3'] };

  test('a live key with no state is refused without --adopt, and nothing is written', async () => {
    const fake = newFake({ budgetSeed: [tier('hf-tier-agent')], keySeed: [live] });
    await expect(keyStack(fake).deploy(declare(declared))).rejects.toThrow();
    expect(fake.keys.writes()).toEqual([]);
  });

  test('with --adopt it is taken over and updated, needing no key value', async () => {
    const fake = newFake({ budgetSeed: [tier('hf-tier-agent')], keySeed: [live] });
    const planned = await keyStack(fake).deploy(declare(declared), { adopt: true });
    expect(Object.values(planned)).toEqual(['adopted']);
    // No `key` in the environment, none in the body: the update finds the key by its alias alone.
    expect(fake.keys.writes()).toEqual([
      { body: { budget_id: null, key_alias: 'seat-a', models: ['glm-5.3'] }, path: '/key/update' },
    ]);
    expect(fake.keys.rows()[0]).toMatchObject({ budget_id: null, models: ['glm-5.3'] });
  });

  test('a create the planner could not probe is refused at apply, not taken over', async () => {
    // `budgetId: tierRow.budgetId` is an Output until the tier exists, so Alchemy skips its
    // adoption probe for this key — the apply-time check is all that stands between a stray
    // declaration and a live credential.
    const fake = newFake({ keySeed: [liveRow({ key_alias: 'seat-a' })] });
    const body = Effect.gen(function* () {
      const tierRow = yield* LiteLLMBudget('Tier', { budgetId: 'hf-tier-x', softBudget: 5 });
      yield* LiteLLMKey('Seat', { keyAlias: 'seat-a', budgetId: tierRow.budgetId });
    });
    const message = await failureOf(keyStack(fake).deploy(body));
    // ★ beta.81 probes at apply itself and refuses first; the kit's check is the backstop.
    expect(message).toMatch(/already exists|Cannot adopt resource 'Seat'.*--adopt/s);
    expect(fake.keys.writes()).toEqual([]);
    await keyStack(fake).deploy(body, { adopt: true });
    expect(paths(fake)).toEqual(['/key/update']);
  });
});

describe('update', () => {
  test('changing budget_id sends only that field, and never the key', async () => {
    const fake = newFake({ budgetSeed: [tier('tier-a'), tier('tier-b')] });
    const stack = keyStack(fake);
    await deploy(stack, { ...seat, budgetId: 'tier-a' });
    expect(await deploy(stack, { ...seat, budgetId: 'tier-b' })).toEqual({ Seat: 'update' });
    expect(fake.keys.writes().at(-1)).toEqual({
      body: { budget_id: 'tier-b', key_alias: 'seat-a' },
      path: '/key/update',
    });
    expect(fake.keys.rows()[0]).toMatchObject({ budget_id: 'tier-b' });
  });

  test('declaring null and [] clears budget_id, models and routes', async () => {
    const fake = newFake({ budgetSeed: [tier('tier-a')] });
    const stack = keyStack(fake);
    await deploy(stack, { ...seat, allowedRoutes: ['/v1/*'], budgetId: 'tier-a', models: ['m'] });
    await deploy(stack, { ...seat, allowedRoutes: [], budgetId: null, models: [] });
    expect(fake.keys.rows()[0]).toMatchObject({ allowed_routes: [], budget_id: null, models: [] });
  });

  test('model order is not a difference', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await deploy(stack, { ...seat, models: ['a', 'b'] });
    expect(await deploy(stack, { ...seat, models: ['b', 'a'] })).toEqual({ Seat: 'noop' });
  });

  test('a proxy that keeps a field it was told to clear fails the apply', async () => {
    const fake = newFake({
      budgetSeed: [tier('hf-tier-agent')],
      keySeed: [liveRow({ budget_id: 'hf-tier-agent' })],
      keyUpdateIgnoresNull: true,
    });
    const message = await failureOf(
      keyStack(fake).deploy(declare({ budgetId: null, keyAlias: 'seat-a' }), { adopt: true }),
    );
    expect(message).toContain('budget_id');
  });

  test('renaming the alias is refused before any write', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await deploy(stack, seat);
    const writes = fake.keys.writes().length;
    const message = await failureOf(deploy(stack, { ...seat, keyAlias: 'seat-b' }));
    expect(message).toContain('seat-b');
    expect(fake.keys.writes()).toHaveLength(writes);
  });
});

describe('duration', () => {
  test('is written on create, remembered, and changed or cleared by an update', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await deploy(stack, { ...seat, duration: '30d' });
    expect(fake.keys.rows()[0]?.['expires']).not.toBeNull();
    expect(await deploy(stack, { ...seat, duration: '30d' })).toEqual({ Seat: 'noop' });
    expect(await deploy(stack, { ...seat, duration: '7d' })).toEqual({ Seat: 'update' });
    expect(fake.keys.writes().at(-1)?.body).toEqual({ duration: '7d', key_alias: 'seat-a' });
    // `duration: null` is the declaration that clears the expiry; leaving it out does not (key-scope.test.ts).
    expect(await deploy(stack, { ...seat, duration: null })).toEqual({ Seat: 'update' });
    expect(fake.keys.writes().at(-1)?.body).toEqual({ duration: null, key_alias: 'seat-a' });
    expect(fake.keys.rows()[0]?.['expires']).toBeNull();
    expect(await deploy(stack, { ...seat, duration: null })).toEqual({ Seat: 'noop' });
  });

  test('an adopted key remembers no duration, so declaring one arms it once', async () => {
    const fake = newFake({ keySeed: [liveRow({ expires: '2099-01-01T00:00:00.000Z' })] });
    const stack = keyStack(fake);
    await stack.deploy(declare({ duration: '30d', keyAlias: 'seat-a' }), { adopt: true });
    expect(fake.keys.writes().at(-1)?.body).toEqual({ duration: '30d', key_alias: 'seat-a' });
    expect(await stack.deploy(declare({ duration: '30d', keyAlias: 'seat-a' }))).toEqual({
      Seat: 'noop',
    });
  });
});

describe('form helpers', () => {
  const row = liveRow({ budget_id: 'tier-a', models: ['a'], metadata: { seat: 'a' } });

  test('toAttributes keeps the compared columns and drops the token hash', () => {
    const attributes = toAttributes(row);
    expect(attributes).toEqual({
      allowedRoutes: [],
      budgetId: 'tier-a',
      duration: null,
      expires: null,
      keyAlias: 'seat-a',
      metadata: { seat: 'a' },
      models: ['a'],
      teamId: null,
      withheld: [],
    });
    expect(JSON.stringify(attributes)).not.toContain('FAKE-TOKEN');
  });

  test('differing names the wire fields, and the update body carries only those', () => {
    const live = toAttributes(row);
    const props = {
      budgetId: 'tier-b',
      keyAlias: 'seat-a',
      metadata: { seat: 'a' },
      models: ['a'],
    };
    expect(differing(live, props)).toEqual(['budget_id']);
    expect(updateBody(props, live)).toEqual({ budget_id: 'tier-b', key_alias: 'seat-a' });
    expect(differing(live, { ...props, budgetId: 'tier-a' })).toEqual([]);
  });
});
