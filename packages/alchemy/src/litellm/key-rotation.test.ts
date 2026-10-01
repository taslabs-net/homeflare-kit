/** Real beta.79 Plan/Apply: only the environment changes; no adoption or incidental drift. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { keyHandlers } from './key.ts';
import {
  FAKE_KEY,
  MASTER_KEY,
  OTHER_FAKE_KEY,
  VAR,
  declare,
  failureOf,
  keyStack,
  newFake,
  runAgainst,
  tokenFor,
  withEnv,
} from './key-harness.ts';

const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a', models: ['old'] };

for (const models of [['new'], seat.models]) {
  test(`an owned key deleted in the dashboard is recreated with models ${models.join(',')}`, async () => {
    const fake = newFake();
    const engine = keyStack(fake);
    await withEnv({ [VAR]: FAKE_KEY }, async () => {
      await engine.deploy(declare(seat));
      const removed = await fake.fetch(`${FAKE_BASE}/key/delete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${MASTER_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key_aliases: [seat.keyAlias] }),
      });
      expect(removed.status).toBe(200);
      expect(fake.keys.rows()).toHaveLength(0);
      const news = { ...seat, models };
      expect(Object.values(await engine.deploy(declare(news)))).toEqual(['update']);
      expect(fake.keys.rows()).toHaveLength(1);
      expect(fake.keys.rows()[0]?.models).toEqual(models);
      expect(fake.keys.received().every((value) => value === FAKE_KEY)).toBe(true);
      expect(Object.values(await engine.deploy(declare(news)))).toEqual(['noop']);
    });
    expect(fake.keys.writes().map((write) => write.path)).toEqual([
      '/key/generate',
      '/key/delete',
      '/key/generate',
    ]);
    expect(engine.snapshot().includes(FAKE_KEY)).toBe(false);
    expect(engine.snapshot().includes(tokenFor(FAKE_KEY))).toBe(false);
  });
}

test('an owned key with identical props refuses a rotated variable during plan', async () => {
  const fake = newFake();
  const engine = keyStack(fake);
  await withEnv({ [VAR]: FAKE_KEY }, () => engine.deploy(declare(seat)));
  const writes = fake.keys.writes().length;
  const state = engine.snapshot();
  const unchanged = await withEnv({ [VAR]: FAKE_KEY }, () => engine.deploy(declare(seat)));
  expect(Object.values(unchanged)).toEqual(['noop']);
  for (const news of [seat, { ...seat, models: ['new'] }]) {
    const message = await failureOf(
      withEnv({ [VAR]: OTHER_FAKE_KEY }, () => engine.deploy(declare(news))),
    );
    expect(message).toContain('is not the key');
    expect(message).toContain(VAR);
    expect(message.includes(OTHER_FAKE_KEY)).toBe(false);
    expect(fake.keys.writes()).toHaveLength(writes);
    expect(engine.snapshot()).toBe(state);
  }
  for (const material of [FAKE_KEY, OTHER_FAKE_KEY, tokenFor(FAKE_KEY), tokenFor(OTHER_FAKE_KEY)]) {
    expect(engine.snapshot().includes(material)).toBe(false);
  }
});

test('the diff refusal is typed and catchTag handles it without storing any key material', async () => {
  const fake = newFake();
  const attributes = await withEnv({ [VAR]: FAKE_KEY }, () =>
    runAgainst(
      fake,
      keyHandlers.reconcile({ fqn: 'Seat', instanceId: 'i-1', news: seat, output: undefined }),
    ),
  );
  const tag = await withEnv({ [VAR]: OTHER_FAKE_KEY }, () =>
    runAgainst(
      fake,
      keyHandlers
        .diff({ news: { ...seat, models: ['new'] }, output: attributes })
        .pipe(
          Effect.catchTag('LitellmKeyValueMismatchError', (error) => Effect.succeed(error._tag)),
        ),
    ),
  );
  expect(tag).toBe('LitellmKeyValueMismatchError');
  expect(fake.keys.writes().map((write) => write.path)).toEqual(['/key/generate']);
});

test('an owned key can update and then noop with the declared variable unset or empty', async () => {
  for (const missing of [undefined, '']) {
    const fake = newFake();
    const engine = keyStack(fake);
    await withEnv({ [VAR]: FAKE_KEY }, () => engine.deploy(declare(seat)));
    const news = { ...seat, models: ['new'] };
    await withEnv({ [VAR]: missing }, async () => {
      expect(Object.values(await engine.deploy(declare(news)))).toEqual(['update']);
      expect(Object.values(await engine.deploy(declare(news)))).toEqual(['noop']);
    });
    expect(fake.keys.writes().map((write) => write.path)).toEqual(['/key/generate', '/key/update']);
    expect(JSON.stringify(fake.keys.writes().slice(1)).includes(FAKE_KEY)).toBe(false);
  }
});
