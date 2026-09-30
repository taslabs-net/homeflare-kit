/**
 * `LiteLLM.Key`'s `metadata`, over the fake: a MERGE that never strips what LiteLLM keeps inside the
 * column (guardrails, per-model limits, passthrough routes), and callback credentials that never
 * reach state (key-metadata.ts has the measured reasons). The fake replaces `metadata` on update, as
 * LiteLLM does, so a body that dropped a folded key would lose it here too.
 */
import { describe, expect, test } from 'bun:test';
import { differing, toAttributes, updateBody } from './key-form.ts';
import {
  FAKE_KEY,
  VAR,
  dashboardEdit,
  declare,
  failureOf,
  keyStack,
  liveRow,
  newFake,
  withEnv,
} from './key-harness.ts';
import { callbackSlotsIn, mergedMetadata, splitMetadata } from './key-metadata.ts';

/** What LiteLLM 1.103 keeps in a key's metadata besides what a person declared. */
const folded = {
  allowed_passthrough_routes: ['/x'],
  guardrails: ['pii-mask'],
  model_rpm_limit: { m: 5 },
  tags: ['prod'],
};
/** A legacy row's plaintext callback config: 1.103 encrypts new ones, old ones pass through. */
const SECRET = 'sk-lf-FAKE-callback-secret-000001';
const logging = [{ callback_name: 'langfuse', callback_vars: { langfuse_secret_key: SECRET } }];
const seat = (metadata: Record<string, unknown>) =>
  liveRow({ metadata: { seat: 'a', ...metadata } });

describe('metadata is a merge', () => {
  test('a declaration that matches what it names writes nothing, however much else the row holds', async () => {
    const fake = newFake({ keySeed: [seat(folded)] });
    const planned = await keyStack(fake).deploy(
      declare({ keyAlias: 'seat-a', metadata: { seat: 'a' } }),
      {
        adopt: true,
      },
    );
    expect(Object.values(planned)).toEqual(['adopted']);
    expect(fake.keys.writes()).toEqual([]);
    expect(fake.keys.rows()[0]?.['metadata']).toEqual({ seat: 'a', ...folded });
  });

  test('changing a declared key resends every live key with it', async () => {
    const fake = newFake({ keySeed: [seat({ ...folded, owner: 'ops' })] });
    await keyStack(fake).deploy(declare({ keyAlias: 'seat-a', metadata: { seat: 'b' } }), {
      adopt: true,
    });
    const expected = { seat: 'b', ...folded, owner: 'ops' };
    expect(fake.keys.writes()).toEqual([
      { body: { key_alias: 'seat-a', metadata: expected }, path: '/key/update' },
    ]);
    expect(fake.keys.rows()[0]?.['metadata']).toEqual(expected);
  });

  test('a setting someone adds to a key the stack owns survives the next update', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    const props = { key: { fromEnv: VAR }, keyAlias: 'seat-a', metadata: { seat: 'a' } };
    const deploy = (models: readonly string[]) =>
      withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare({ ...props, models })));
    expect(await deploy([])).toEqual({ Seat: 'create' });
    await dashboardEdit(fake, 'seat-a', { metadata: { seat: 'a', ...folded } });
    // ★ THE NEXT DEPLOY'S RECONCILE READS THE ROW, SEES THE GUARDRAIL AND MUST NOT SEND `metadata`
    //   AT ALL: the declared key already matches, and a body without it leaves the column as it is.
    expect(await deploy(['m'])).toEqual({ Seat: 'update' });
    expect(fake.keys.writes().at(-1)?.body).toEqual({ key_alias: 'seat-a', models: ['m'] });
    expect(fake.keys.rows()[0]?.['metadata']).toEqual({ seat: 'a', ...folded });
  });

  test('a key is cleared by declaring it null, and is quiet after', async () => {
    const fake = newFake({ keySeed: [seat(folded)] });
    const stack = keyStack(fake);
    const props = { keyAlias: 'seat-a', metadata: { seat: null } };
    await stack.deploy(declare(props), { adopt: true });
    expect(fake.keys.rows()[0]?.['metadata']).toEqual({ seat: null, ...folded });
    expect(await stack.deploy(declare(props))).toEqual({ Seat: 'noop' });
  });

  test('form: only declared keys differ, and the body merges', () => {
    const live = toAttributes(seat(folded));
    expect(differing(live, { keyAlias: 'seat-a', metadata: { seat: 'a' } })).toEqual([]);
    const props = { keyAlias: 'seat-a', metadata: { seat: 'b' } };
    expect(differing(live, props)).toEqual(['metadata']);
    expect(updateBody(props, live)).toEqual({
      key_alias: 'seat-a',
      metadata: { seat: 'b', ...folded },
    });
    expect(mergedMetadata({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe('callback credentials never reach state', () => {
  const held = seat({ ...folded, logging });

  test('an adopted key with legacy plaintext logging leaves the secret out of state', async () => {
    const fake = newFake({ keySeed: [held] });
    const stack = keyStack(fake);
    const props = { keyAlias: 'seat-a', metadata: { seat: 'a' } };
    await stack.deploy(declare(props), { adopt: true });
    expect(fake.keys.writes()).toEqual([]);
    const state = stack.snapshot();
    expect(state).not.toContain(SECRET);
    expect(state).toContain('logging'); // the slot's NAME is what state keeps
    expect(state).toContain('pii-mask'); // and the rest of the metadata, which it needs to carry it
  });

  test('a metadata write onto a key that holds callback config is refused, nothing written', async () => {
    const fake = newFake({ keySeed: [held] });
    const message = await failureOf(
      keyStack(fake).deploy(declare({ keyAlias: 'seat-a', metadata: { seat: 'b' } }), {
        adopt: true,
      }),
    );
    expect(message).toContain('logging');
    expect(message).not.toContain(SECRET);
    expect(fake.keys.writes()).toEqual([]);
    expect(fake.keys.rows()[0]?.['metadata']).toEqual({ seat: 'a', ...folded, logging });
  });

  test('a write that touches no metadata still goes ahead on such a key', async () => {
    const fake = newFake({ keySeed: [held] });
    await keyStack(fake).deploy(declare({ keyAlias: 'seat-a', models: ['m'] }), { adopt: true });
    expect(fake.keys.writes()).toEqual([
      { body: { key_alias: 'seat-a', models: ['m'] }, path: '/key/update' },
    ]);
    expect(fake.keys.rows()[0]?.['metadata']).toMatchObject({ logging });
  });

  for (const slot of ['logging', 'callback_settings', 'secret_manager_settings']) {
    test(`a declaration naming ${slot} is refused before anything is written`, async () => {
      const fake = newFake();
      const props = {
        keyAlias: 'seat-a',
        metadata: { [slot]: [{ callback_vars: { k: SECRET } }] },
      };
      const message = await failureOf(keyStack(fake).deploy(declare(props)));
      expect(message).toContain(slot);
      expect(message).not.toContain(SECRET);
      expect(fake.requests().filter((each) => each.method !== 'GET')).toEqual([]);
    });
  }

  test('form: the slots are split off the row, and only their names stay', () => {
    const split = splitMetadata({ seat: 'a', logging, callback_settings: {} });
    expect(split).toEqual({ metadata: { seat: 'a' }, withheld: ['callback_settings', 'logging'] });
    expect(JSON.stringify(toAttributes(held))).not.toContain(SECRET);
    expect(callbackSlotsIn(undefined)).toEqual([]);
    expect(callbackSlotsIn({ tags: [] })).toEqual([]);
  });
});
