/**
 * `LiteLLM.Key`'s create when the connection to the proxy fails: the key is IN the request body of
 * `/key/generate`, and an `HttpClientError` carries its request, so a create that dies on the wire
 * would hand the plaintext to whoever logs, inspects or serialises the failure. Every place a failed
 * create can be read from is searched here for a value the tests can find (`FAKE_KEY`).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import { keyHandlers } from './key.ts';
import {
  FAKE_KEY,
  type Fake,
  VAR,
  declare,
  keyStack,
  newFake,
  runAgainst,
  withEnv,
} from './key-harness.ts';

const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a' } as const;
const reconcile = () =>
  keyHandlers.reconcile({ fqn: 'Seat', instanceId: 'i-1', news: seat, output: undefined });

const pathOf = (input: string | URL | Request) =>
  new URL(input instanceof Request ? input.url : String(input)).pathname;

/** The fake, with `/key/generate` answered by `onGenerate` and every other route its own. */
const generatingWith = (fake: Fake, onGenerate: () => Promise<Response>): Fake => ({
  ...fake,
  fetch: (async (input: string | URL | Request, init?: RequestInit) =>
    pathOf(input) === '/key/generate'
      ? onGenerate()
      : fake.fetch(input, init)) as typeof globalThis.fetch,
});

/** The connection drops: `fetch` rejects before any answer. */
const droppedConnection = (fake: Fake): Fake =>
  generatingWith(fake, () => Promise.reject(new TypeError('fetch failed')));

/** The answer starts (200, headers) and its body then fails mid-read: the SDK reads it with `orDie`. */
const brokenAnswer = (fake: Fake): Fake =>
  generatingWith(fake, () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start: (controller) => controller.error(new Error('connection reset mid-body')),
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    ),
  );

/** What Effect's own JSON logger prints for `Effect.logError('create failed', value)`. */
const jsonLogged = async (value: unknown): Promise<string> => {
  const lines: string[] = [];
  const capture = Logger.make((options) => void lines.push(Logger.formatJson.log(options)));
  await Effect.runPromise(
    Effect.logError('create failed', value).pipe(Effect.provide(Logger.layer([capture]))),
  );
  return lines.join('\n');
};

/** Every reading of `value` a caller could take: serialise, deep-inspect, print, log. */
const everyReadingOf = async (value: unknown): Promise<string> => {
  const readings = [Bun.inspect(value, { depth: 12 }), String(value), await jsonLogged(value)];
  try {
    readings.push(JSON.stringify(value));
  } catch {
    // a value JSON cannot serialise leaks nothing that way
  }
  if (value instanceof Error) readings.push(value.message, String(value.stack));
  return readings.join('\n');
};

const rejectionOf = (attempt: Promise<unknown>): Promise<unknown> =>
  attempt.then(
    () => undefined,
    (error: unknown) => error,
  );

describe('a create that dies on the wire', () => {
  test('fails with a typed error that names the alias and holds no request', async () => {
    const fake = droppedConnection(newFake());
    const error = await withEnv({ [VAR]: FAKE_KEY }, () =>
      runAgainst(fake, Effect.flip(reconcile())),
    );
    expect(error).toMatchObject({
      _tag: 'LitellmKeyTransportError',
      keyAlias: 'seat-a',
      reason: 'TransportError',
    });
    expect(Object.keys(error)).not.toContain('request');
    expect(Object.keys(error)).not.toContain('cause');
    expect(await everyReadingOf(error)).not.toContain(FAKE_KEY);
  });

  test('a create whose ANSWER was lost leaves a live key, and the next deploy takes it with --adopt', async () => {
    const fake = newFake();
    let answerLost = true;
    const flaky: Fake = {
      ...fake,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const answer = await fake.fetch(input, init);
        if (answerLost && pathOf(input) === '/key/generate') throw new TypeError('fetch failed');
        return answer;
      }) as typeof globalThis.fetch,
    };
    const stack = keyStack(flaky, { noRetry: true });
    const first = await rejectionOf(
      withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare(seat))),
    );
    expect(String((first as Error).message ?? first)).toContain('/key/generate request failed');
    expect(fake.keys.rows()).toHaveLength(1); // the key DID land: the message says "MAY", and it was right

    answerLost = false;
    const refused = await rejectionOf(
      withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare(seat))),
    );
    expect(String(refused)).toContain('adopt'); // what the error message tells the operator to use
    await withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare(seat), { adopt: true }));
    expect(fake.keys.writes().map((write) => write.path)).toEqual(['/key/generate']);
    expect(fake.keys.rows()).toHaveLength(1);
  });

  test('through the engine the deploy rejects with nothing of the key in it', async () => {
    const fake = droppedConnection(newFake());
    const rejection = await rejectionOf(
      withEnv({ [VAR]: FAKE_KEY }, () => keyStack(fake, { noRetry: true }).deploy(declare(seat))),
    );
    expect(rejection).toBeDefined();
    expect(await everyReadingOf(rejection)).not.toContain(FAKE_KEY);
    expect(fake.keys.writes()).toEqual([]);
  });

  test('a body that fails mid-read (a defect in the SDK) leaks nothing either', async () => {
    const fake = brokenAnswer(newFake());
    const exit = await withEnv({ [VAR]: FAKE_KEY }, () =>
      runAgainst(fake, Effect.exit(reconcile())),
    );
    expect(exit._tag).toBe('Failure');
    expect(await everyReadingOf(exit)).not.toContain(FAKE_KEY);
    const rejection = await rejectionOf(
      withEnv({ [VAR]: FAKE_KEY }, () => keyStack(fake, { noRetry: true }).deploy(declare(seat))),
    );
    expect(rejection).toBeDefined();
    expect(await everyReadingOf(rejection)).not.toContain(FAKE_KEY);
  });
});

describe('a transport failure on a call that carries no value keeps the SDK error', () => {
  test('/key/list dropping is still the SDK error, so a read failure keeps its detail', async () => {
    const fake: Fake = {
      ...newFake(),
      fetch: (async (_input: string | URL | Request): Promise<Response> => {
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch,
    };
    const error = await runAgainst(
      fake,
      Effect.flip(keyHandlers.read({ olds: { keyAlias: 'seat-a' }, output: undefined })),
    );
    expect(error).toMatchObject({ _tag: 'HttpClientError' });
  });
});
