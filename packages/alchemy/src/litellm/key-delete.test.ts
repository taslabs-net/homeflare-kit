/**
 * `LiteLLM.Key` removal and read failures: what a delete does to a key that is there, one that is
 * not, one it may not remove, and what a proxy that cannot be reached must never be taken to mean.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { keyHandlers } from './key.ts';
import type { KeyAttributes } from './key-form.ts';
import {
  FAKE_KEY,
  VAR,
  declare,
  failureOf,
  keyStack,
  liveRow,
  newFake,
  runAgainst,
  withEnv,
} from './key-harness.ts';

const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a' } as const;
const attributes: KeyAttributes = {
  allowedRoutes: [],
  budgetId: null,
  duration: null,
  expires: null,
  keyAlias: 'seat-a',
  metadata: {},
  models: [],
  teamId: null,
};
const paths = (fake: ReturnType<typeof newFake>) => fake.keys.writes().map((write) => write.path);
const create = (stack: ReturnType<typeof keyStack>, destroy: boolean) =>
  withEnv({ [VAR]: FAKE_KEY }, () =>
    stack.deploy(destroy ? declare(seat).pipe(RemovalPolicy.destroy()) : declare(seat)),
  );

describe('delete', () => {
  test('retain is the default: dropping the declaration leaves the key live and sends no delete', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await create(stack, false);
    await stack.deploy(Effect.void);
    expect(fake.keys.rows()).toHaveLength(1);
    expect(paths(fake)).toEqual(['/key/generate']);
  });

  test('RemovalPolicy.destroy() reaches delete, by alias, with no key in the body', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await create(stack, true);
    await stack.deploy(Effect.void);
    expect(fake.keys.rows()).toEqual([]);
    expect(fake.keys.writes().at(-1)).toEqual({
      body: { key_aliases: ['seat-a'] },
      path: '/key/delete',
    });
  });

  test('deleting a key that is already gone succeeds and writes nothing', async () => {
    const fake = newFake();
    await runAgainst(fake, keyHandlers.delete({ output: attributes }));
    expect(fake.keys.writes()).toEqual([]);
    // ★ SETTLED BY THE LIST, not by what `/key/delete` answers for an absent alias (unmeasured).
    expect(fake.requests().map((r) => `${r.method} ${r.path.split('?')[0]}`)).toEqual([
      'GET /key/list',
    ]);
  });

  test('a delete another caller won the race for is swallowed once a re-list shows it gone', async () => {
    const fake = newFake({ keyDeleteRaces: true, keySeed: [liveRow()] });
    await runAgainst(fake, keyHandlers.delete({ output: attributes }));
    expect(fake.keys.rows()).toEqual([]);
  });

  test('a delete the caller may not make is NOT swallowed: it fails and the key stays', async () => {
    const fake = newFake({ keyDeleteForbidden: true, keySeed: [liveRow()] });
    const error = await runAgainst(fake, Effect.flip(keyHandlers.delete({ output: attributes })));
    expect(error).toMatchObject({ _tag: 'Forbidden' });
    expect(fake.keys.rows()).toHaveLength(1);
  });
});

describe('a read that fails is not an absence', () => {
  test('a 503 on /key/list propagates typed from read, reconcile and delete', async () => {
    const fake = newFake({ keyListStatus: 503, keySeed: [liveRow()] });
    const olds = { keyAlias: 'seat-a' };
    const readFailure = await runAgainst(
      fake,
      Effect.flip(keyHandlers.read({ olds, output: attributes })),
    );
    expect(readFailure).toMatchObject({ _tag: 'ServiceUnavailable' });
    const deleteFailure = await runAgainst(
      fake,
      Effect.flip(keyHandlers.delete({ output: attributes })),
    );
    expect(deleteFailure).toMatchObject({ _tag: 'ServiceUnavailable' });
    const reconcileFailure = await runAgainst(
      fake,
      Effect.flip(
        keyHandlers.reconcile({ fqn: 'Seat', instanceId: 'i', news: olds, output: attributes }),
      ),
    );
    expect(reconcileFailure).toMatchObject({ _tag: 'ServiceUnavailable' });
    expect(fake.keys.writes()).toEqual([]);
  });

  test('through the engine a 503 fails the deploy: no create is attempted on "absent"', async () => {
    const fake = newFake({ keyListStatus: 503 });
    const message = await failureOf(
      withEnv({ [VAR]: FAKE_KEY }, () => keyStack(fake, { noRetry: true }).deploy(declare(seat))),
    );
    expect(message).not.toBe('');
    expect(fake.keys.writes()).toEqual([]);
  });

  test('two keys under one alias are refused rather than one picked', async () => {
    const fake = newFake({ keySeed: [liveRow(), liveRow({ token: 'FAKE-TOKEN-2' })] });
    const error = await runAgainst(
      fake,
      Effect.flip(keyHandlers.read({ olds: { keyAlias: 'seat-a' }, output: attributes })),
    );
    expect(error).toMatchObject({ _tag: 'LitellmKeyAmbiguousAliasError', count: 2 });
  });

  test('a hash list (return_full_object ignored) is unreadable, not "no key"', async () => {
    const fake = newFake();
    const listOfHashes = {
      ...fake,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === '/key/list') {
          return new Response(JSON.stringify({ keys: ['FAKE-TOKEN-HASH'] }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return fake.fetch(input, init);
      }) as typeof globalThis.fetch,
    };
    const error = await runAgainst(
      listOfHashes,
      Effect.flip(keyHandlers.read({ olds: { keyAlias: 'seat-a' }, output: attributes })),
    );
    expect(error).toMatchObject({ _tag: 'LitellmKeyUnreadableError' });
  });
});
