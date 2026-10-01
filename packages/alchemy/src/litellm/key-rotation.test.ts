/** Real beta.79 Plan/Apply: only the environment changes; no adoption or incidental drift. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { keyHandlers } from './key.ts';
import {
  FAKE_KEY,
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

test('an owned key with identical props refuses a rotated variable during plan', async () => {
  const fake = newFake();
  const engine = keyStack(fake);
  await withEnv({ [VAR]: FAKE_KEY }, () => engine.deploy(declare(seat)));
  const writes = fake.keys.writes().length;
  const state = engine.snapshot();
  const unchanged = await withEnv({ [VAR]: FAKE_KEY }, () => engine.deploy(declare(seat)));
  expect(Object.values(unchanged)).toEqual(['noop']);
  const message = await failureOf(
    withEnv({ [VAR]: OTHER_FAKE_KEY }, () => engine.deploy(declare(seat))),
  );
  expect(message).toContain('is not the key');
  expect(message).toContain(VAR);
  expect(message.includes(OTHER_FAKE_KEY)).toBe(false);
  expect(fake.keys.writes()).toHaveLength(writes);
  expect(engine.snapshot()).toBe(state);
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
        .diff({ news: seat, output: attributes })
        .pipe(
          Effect.catchTag('LitellmKeyValueMismatchError', (error) => Effect.succeed(error._tag)),
        ),
    ),
  );
  expect(tag).toBe('LitellmKeyValueMismatchError');
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
