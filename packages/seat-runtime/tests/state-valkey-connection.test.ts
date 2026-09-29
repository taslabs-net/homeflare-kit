/**
 * The layer's own reconnect (src/state-valkey-connection.ts) against a fake client, so it runs in
 * CI where no `valkey-server` is installed. tests/state-valkey-reconnect.test.ts runs the same
 * against a real server killed for longer than Bun's retry budget.
 *
 * ★ THE FAKE FOLLOWS WHAT WAS MEASURED ON `Bun.RedisClient` (Bun 1.4.0): a `connect()` that fails
 *   runs `onclose` too, one that succeeds sets `connected`, and `onclose` also runs on `close()`.
 */
import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { type Reconnectable, keepConnected } from '../src/state-valkey-connection.ts';
import { withSpans } from './state-trace.ts';

type Step = 'fail' | 'ok' | 'hang';

type Fake = Reconnectable & {
  connected: boolean;
  connects: number;
  /** Settle the oldest `hang`: it succeeds, and the client is connected. */
  release: () => void;
};

/** A client whose successive `connect()` calls do what `plan` says (then succeed). */
function fake(plan: Step[]): Fake {
  const hung: Array<() => void> = [];
  const client: Fake = {
    connected: false,
    connects: 0,
    onclose: null,
    connect() {
      client.connects += 1;
      const step = plan.shift() ?? 'ok';
      if (step === 'ok') {
        client.connected = true;
        return Promise.resolve();
      }
      if (step === 'fail') {
        return Promise.resolve().then(() => {
          client.onclose?.call(client as never, new Error('Connection closed'));
          throw new Error('Connection closed');
        });
      }
      return new Promise<void>((resolve) => {
        hung.push(() => {
          client.connected = true;
          resolve();
        });
      });
    },
    release: () => hung.shift()?.(),
  };
  return client;
}

const options = {
  connectionTimeout: 40,
  attributes: { 'server.address': '10.0.0.9' },
  firstPause: 5,
  longestPause: 20,
};

/** Poll until `done`, or fail after 3 s: real timers, so a slow machine is not a flake. */
const until = (done: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300 && !done(); i++) yield* Effect.sleep(10);
    return done();
  });

test('after Bun gives up (onclose), it reconnects, one span per attempt, and stops when it is up', async () => {
  const client = fake(['fail', 'fail']);
  const { exit, spans } = await withSpans(
    Effect.scoped(
      Effect.gen(function* () {
        yield* keepConnected(client, options);
        client.connected = false;
        client.onclose?.call(client as never, new Error('Connection closed'));
        const up = yield* until(() => client.connected);
        // The failed attempts each ran `onclose` themselves: none of that may start another loop.
        yield* Effect.sleep(150);
        return { up, connects: client.connects };
      }),
    ),
  );
  expect(exit).toMatchObject({ _tag: 'Success', value: { up: true, connects: 3 } });
  const attempts = spans.filter((span) => span.name === 'valkey reconnect');
  expect(attempts.map((span) => span.ended)).toEqual(['Failure', 'Failure', 'Success']);
  expect(attempts[0]?.attributes).toEqual({ 'server.address': '10.0.0.9' });
});

test('a wake-up while the client is connected does nothing', async () => {
  const client = fake([]);
  client.connected = true;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* keepConnected(client, options);
        client.onclose?.call(client as never, new Error('Connection closed'));
        yield* Effect.sleep(100);
      }),
    ),
  );
  expect(client.connects).toBe(0);
});

test('one connect() in flight: a timed-out attempt is awaited again, not repeated on top of', async () => {
  const client = fake(['hang']);
  const connects = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* keepConnected(client, options);
        client.onclose?.call(client as never, new Error('Connection closed'));
        // Several attempts time out (40 ms each) while the first connect() is still pending.
        yield* Effect.sleep(250);
        const whilePending = client.connects;
        client.release();
        const up = yield* until(() => client.connected);
        return { whilePending, up, final: client.connects };
      }),
    ),
  );
  expect(connects).toEqual({ whilePending: 1, up: true, final: 1 });
});

test('closing the scope stops it: nothing reconnects afterwards, and onclose is never null', async () => {
  const client = fake([]);
  const installed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* keepConnected(client, options);
        return client.onclose;
      }),
    ),
  );
  // ⛔ Bun's `close()` calls whatever `onclose` holds, so it must stay callable (no-op) afterwards.
  expect(installed).not.toBeNull();
  expect(client.onclose).not.toBeNull();
  expect(client.onclose).not.toBe(installed);
  client.connected = false;
  client.onclose?.call(client as never, new Error('Connection closed'));
  await Bun.sleep(100);
  expect(client.connects).toBe(0);
});
