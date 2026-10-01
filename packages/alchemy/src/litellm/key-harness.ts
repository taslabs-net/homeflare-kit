/**
 * What every `LiteLLM.Key` test needs, in one place — TEST ONLY, never imported by `index.ts` (the
 * `mesh-node-harness.ts` convention).
 *
 * ⛔ EVERY KEY VALUE IN THE TESTS IS SYNTHETIC: `sk-FAKE-…`, never a value that ever authenticated
 *   anything. A test that asserts a value is absent from a place needs a value it can search for.
 */
import { credentials } from '@distilled.cloud/litellm/Credentials';
import { Retry } from '@distilled.cloud/litellm/Retry';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_BASE, startFakeLitellm } from './fake-litellm.ts';
import { type FakeStack, fakeStack } from './fake-stack.ts';
import { LiteLLMKey } from './key.ts';
import type { KeyProps } from './key-form.ts';
import type { LitellmOpContext } from './operations.ts';

export const MASTER_KEY = 'sk-test-master';
/** A valid user-defined key (`sk-` and 16+ characters) that is obviously not a real one. */
export const FAKE_KEY = 'sk-FAKE-seat-key-000000000001';
export const OTHER_FAKE_KEY = 'sk-FAKE-seat-key-000000000002';
export const VAR = 'FAKE_LITELLM_SEAT_KEY';

/** The row's `token` for a value, the same sha256 the fake and the vendor store (`hash_token`). */
export const tokenFor = (value: string): string =>
  new Bun.CryptoHasher('sha256').update(value).digest('hex');

export type Fake = ReturnType<typeof startFakeLitellm>;

export const newFake = (options?: Parameters<typeof startFakeLitellm>[0]): Fake =>
  startFakeLitellm({ masterKey: MASTER_KEY, ...options });

export const keyStack = (fake: Fake, settings?: { readonly noRetry?: boolean }): FakeStack =>
  fakeStack({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE }, fake.fetch, 'KeyStack', settings);

/** One declaration as a stack body. `name` is the resource's logical id. */
export const declare = (props: KeyProps, name = 'Seat') =>
  Effect.gen(function* () {
    yield* LiteLLMKey(name, props);
  });

/**
 * Runs `body` with `values` in `process.env`, then puts the environment back exactly as it was.
 * ⚠️ THE PROVIDER READS `process.env` AT CALL TIME (write-only.ts `resolveAll`), so the variable
 *   has to be there for the whole deploy and gone after it.
 */
export const withEnv = async <A>(
  values: Readonly<Record<string, string | undefined>>,
  body: () => Promise<A>,
): Promise<A> => {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The message a rejected deploy carries, or `''` when it did not reject. */
export const failureOf = async (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/**
 * Runs one handler effect against the fake outside any stack (a handler-level test), with the SDK's
 * retry OFF: a test of a failing call wants the failure, not the backoff before it.
 */
export const runAgainst = <A, E>(
  fake: Fake,
  effect: Effect.Effect<A, E, LitellmOpContext>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(Retry, { while: () => false }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fake.fetch)),
      Effect.provide(credentials({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

/** A seeded live row shaped like `UserAPIKeyAuth`, with a hash `token` a resource must never surface. */
export const liveRow = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  allowed_routes: [],
  blocked: null,
  budget_id: null,
  expires: null,
  key_alias: 'seat-a',
  metadata: {},
  models: [],
  spend: 0,
  team_id: null,
  token: 'FAKE-TOKEN-HASH-do-not-surface',
  ...fields,
});

/**
 * Someone changing a live key outside the stack — the dashboard's `/key/update` — through the fake's
 * own route, so it replaces `metadata` the way LiteLLM does. It shows in `fake.keys.writes()`.
 */
export const dashboardEdit = async (
  fake: Fake,
  keyAlias: string,
  patch: Record<string, unknown>,
): Promise<void> => {
  const response = await fake.fetch(`${FAKE_BASE}/key/update`, {
    body: JSON.stringify({ key_alias: keyAlias, ...patch }),
    headers: { authorization: `Bearer ${MASTER_KEY}`, 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`dashboard edit failed: ${response.status}`);
};
