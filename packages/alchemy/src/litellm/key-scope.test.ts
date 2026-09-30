/**
 * `LiteLLM.Key` manages only what a declaration names. An omitted `budgetId`, `models`,
 * `allowedRoutes`, `teamId` or `duration` must not mean "clear it", because clearing FAILS OPEN on a
 * credential: `[]` is "all models" and "no route restriction" to LiteLLM, and an adopted key's plan
 * says `adopted`, never what the apply would write (key-form.ts's header).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { LiteLLMBudget } from './budget.ts';
import { LiteLLMKey } from './key.ts';
import { createBody, differing, toAttributes } from './key-form.ts';
import { FAKE_KEY, VAR, declare, keyStack, liveRow, newFake, withEnv } from './key-harness.ts';

const tier = (id: string) => ({ budget_id: id, created_at: 'x', updated_at: 'x' });
/** A key scoped as narrowly as a seat's: one model, one route, a tier, a team, an expiry. */
const scoped = () =>
  liveRow({
    allowed_routes: ['/v1/embeddings'],
    budget_id: 'old-tier',
    expires: '2099-01-01T00:00:00.000Z',
    models: ['embed-only'],
    team_id: 'team-a',
  });
const stillScoped = {
  allowed_routes: ['/v1/embeddings'],
  budget_id: 'old-tier',
  expires: '2099-01-01T00:00:00.000Z',
  models: ['embed-only'],
  team_id: 'team-a',
};

describe('an omitted prop is left alone', () => {
  test('adopting with only the alias writes nothing: the scoped key is not widened', async () => {
    const fake = newFake({ budgetSeed: [tier('old-tier')], keySeed: [scoped()] });
    const planned = await keyStack(fake).deploy(declare({ keyAlias: 'seat-a' }), { adopt: true });
    expect(Object.values(planned)).toEqual(['adopted']);
    expect(fake.keys.writes()).toEqual([]);
    expect(fake.keys.rows()[0]).toMatchObject(stillScoped);
  });

  test('a budget bound by Output writes only the budget: models and routes stay', async () => {
    // The documented declaration. Its plan says `create` (an Output cannot be probed), and reading
    // the omissions as "clear" would send `models: []` and `allowed_routes: []` with the budget.
    const fake = newFake({ keySeed: [scoped()] });
    const body = Effect.gen(function* () {
      const tierRow = yield* LiteLLMBudget('Tier', { budgetId: 'hf-tier-new', softBudget: 5 });
      yield* LiteLLMKey('Seat', { budgetId: tierRow.budgetId, keyAlias: 'seat-a' });
    });
    await keyStack(fake).deploy(body, { adopt: true });
    expect(fake.keys.writes().filter((write) => write.path === '/key/update')).toEqual([
      { body: { budget_id: 'hf-tier-new', key_alias: 'seat-a' }, path: '/key/update' },
    ]);
    expect(fake.keys.rows()[0]).toMatchObject({
      ...stillScoped,
      budget_id: 'hf-tier-new',
    });
  });

  test('a key the stack owns keeps what a later declaration stops naming', async () => {
    const fake = newFake({ budgetSeed: [tier('tier-a')] });
    const stack = keyStack(fake);
    const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a' } as const;
    const full = {
      ...seat,
      allowedRoutes: ['/v1/*'],
      budgetId: 'tier-a',
      models: ['m'],
      teamId: 't',
    };
    await withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare(full)));
    const writes = fake.keys.writes().length;
    expect(await stack.deploy(declare(seat))).toEqual({ Seat: 'noop' });
    expect(fake.keys.writes()).toHaveLength(writes);
    expect(fake.keys.rows()[0]).toMatchObject({
      allowed_routes: ['/v1/*'],
      budget_id: 'tier-a',
      models: ['m'],
      team_id: 't',
    });
  });
});

describe('clearing is an explicit declaration', () => {
  test('[] and null clear a live scope, and the update body says so', async () => {
    const fake = newFake({ budgetSeed: [tier('old-tier')], keySeed: [scoped()] });
    await keyStack(fake).deploy(
      declare({
        allowedRoutes: [],
        budgetId: null,
        duration: null,
        keyAlias: 'seat-a',
        models: [],
        teamId: null,
      }),
      { adopt: true },
    );
    expect(fake.keys.writes()).toEqual([
      {
        body: {
          allowed_routes: [],
          budget_id: null,
          duration: null,
          key_alias: 'seat-a',
          models: [],
          team_id: null,
        },
        path: '/key/update',
      },
    ]);
  });

  test('a declared null on a key that already has nothing is quiet', () => {
    const live = toAttributes(liveRow());
    expect(
      differing(live, { budgetId: null, duration: null, keyAlias: 'seat-a', teamId: null }),
    ).toEqual([]);
  });
});

describe('form helpers', () => {
  const live = toAttributes(scoped());

  test('differing names nothing the declaration does not', () => {
    expect(differing(live, { keyAlias: 'seat-a' })).toEqual([]);
    expect(differing(live, { keyAlias: 'seat-a', models: ['other'] })).toEqual(['models']);
  });

  test('a new key is sent only what is declared, and a declared null is not sent', () => {
    const secret = Redacted.make(FAKE_KEY);
    expect(
      Object.keys(createBody({ budgetId: null, keyAlias: 'seat-a', teamId: null }, secret)),
    ).toEqual(['key', 'key_alias']);
  });
});
