/**
 * `LiteLLM.PassThroughEndpoint`'s lifecycle handlers, called directly against `fake-litellm.ts` —
 * the loopback-fake pattern this kit uses in place of `alchemy/Test/*` (H12, no live writes).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { litellmCredentialsLayerFor } from './credentials.ts';
import { type FakeLitellm, startFakeLitellm } from './fake-litellm.ts';
import { createPassThroughEndpoint } from './client.ts';
import {
  LitellmConfigPathConflictError,
  LitellmLiteralSecretHeaderError,
  type PassThroughEndpointProps,
  passThroughHandlers as h,
} from './pass-through-endpoint.ts';

const MASTER_KEY = 'sk-test-master';
const INSTANCE_ID = 'a'.repeat(32);
const FAKE_STACK = { actions: {}, bindings: {}, name: 's', resources: {}, stage: 'test' } as never;

let fake: FakeLitellm;
beforeEach(() => {
  fake = startFakeLitellm({ masterKey: MASTER_KEY });
});
afterEach(() => fake.stop());

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>);

const withServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(litellmCredentialsLayerFor({ apiKey: MASTER_KEY, baseUrl: fake.url })),
    Effect.provideService(Stage, 'test'),
    Effect.provideService(Stack, FAKE_STACK),
  ) as Effect.Effect<A, E, never>;

const PROPS: PassThroughEndpointProps = { path: '/bria', target: 'https://api.bria.ai' };
const reconcileNew = (news: PassThroughEndpointProps) =>
  run(
    withServices(h.reconcile({ id: 'Endpoint', instanceId: INSTANCE_ID, news, output: undefined })),
  );

describe('create then plan again', () => {
  test('a second read/diff against the same declaration is noop, with no write', async () => {
    const attrs = await reconcileNew(PROPS);
    const before = fake.requests().length;
    const read = await run(
      withServices(h.read({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: attrs })),
    );
    const diff = await run(withServices(h.diff({ news: PROPS, output: read })));
    expect(diff).toEqual({ action: 'noop' });
    expect(
      fake
        .requests()
        .slice(before)
        .some((r) => r.method !== 'GET'),
    ).toBe(false);
  });
});

describe('a header edit', () => {
  test('is one POST /{id} carrying the whole headers dict', async () => {
    const attrs = await reconcileNew(PROPS);
    const before = fake.requests().length;
    const news = { ...PROPS, headers: { 'X-Client': 'v2' } };
    await run(
      withServices(h.reconcile({ id: 'Endpoint', instanceId: INSTANCE_ID, news, output: attrs })),
    );
    const writes = fake
      .requests()
      .slice(before)
      .filter((r) => r.method !== 'GET');
    expect(writes).toEqual([{ method: 'POST', path: `/config/pass_through_endpoint/${attrs.id}` }]);
    expect(fake.rows().find((r) => r.id === attrs.id)?.headers).toEqual({ 'X-Client': 'v2' });
  });
});

describe('clearing a nullable field', () => {
  test('is a replace: delete before create, never two rows on one path', async () => {
    const attrs = await reconcileNew({ ...PROPS, timeout: 30 });
    const oldId = attrs.id;
    const before = fake.requests().length;
    const after = await run(
      withServices(
        h.reconcile({ id: 'Endpoint', instanceId: INSTANCE_ID, news: PROPS, output: attrs }),
      ),
    );
    const writes = fake
      .requests()
      .slice(before)
      .filter((r) => r.method !== 'GET')
      .map((r) => r.method);
    expect(writes).toEqual(['DELETE', 'POST']);
    expect(fake.rows().filter((r) => r.path === '/bria')).toHaveLength(1);
    expect(after.id).toBe(oldId); // same deterministic id, recreated
    expect(after.timeout).toBeUndefined();
  });
});

describe('delete', () => {
  test('an already-gone id succeeds with no DELETE call', async () => {
    const attrs = await reconcileNew(PROPS);
    await run(
      withServices(
        h.delete({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: attrs }),
      ),
    );
    const before = fake.requests().length;
    await run(
      withServices(
        h.delete({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: attrs }),
      ),
    );
    expect(
      fake
        .requests()
        .slice(before)
        .some((r) => r.method === 'DELETE'),
    ).toBe(false);
  });
});

describe('two endpoints created in one deploy', () => {
  /** ⛔ Fails without client.ts's per-base-URL semaphore — the fake's race window (RACE_WINDOW_MS) proves it. */
  test('both survive the shared general_settings field', async () => {
    const a: PassThroughEndpointProps = { path: '/a', target: 'https://a.example.com' };
    const b: PassThroughEndpointProps = { path: '/b', target: 'https://b.example.com' };
    await Effect.runPromise(
      Effect.all(
        [
          withServices(createPassThroughEndpoint({ ...a, id: 'ep-a' })),
          withServices(createPassThroughEndpoint({ ...b, id: 'ep-b' })),
        ],
        { concurrency: 'unbounded' },
      ),
    );
    expect(
      fake
        .rows()
        .map((r) => r.path)
        .sort(),
    ).toEqual(['/a', '/b']);
  });
});

describe('a path held by an is_from_config row', () => {
  test('is refused at read, before any write', async () => {
    fake.stop();
    fake = startFakeLitellm({
      masterKey: MASTER_KEY,
      seed: [{ ...PROPS, id: 'cfg-1', is_from_config: true }],
    });
    const result = run(
      withServices(
        h.read({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: undefined }),
      ),
    );
    await expect(result).rejects.toThrow(LitellmConfigPathConflictError as never);
    expect(fake.requests().every((r) => r.method === 'GET')).toBe(true);
  });
});

describe('a foreign DB row on the same path', () => {
  test('is Unowned, and read works with output undefined', async () => {
    fake.stop();
    fake = startFakeLitellm({
      masterKey: MASTER_KEY,
      seed: [{ ...PROPS, id: 'foreign-1', is_from_config: false }],
    });
    const result = await run(
      withServices(
        h.read({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: undefined }),
      ),
    );
    expect(Unowned.is(result)).toBe(true);
    expect(result?.id).toBe('foreign-1');
  });
});

describe('a literal secret header', () => {
  test('is refused at plan (diff), before any write', async () => {
    const news = { ...PROPS, headers: { Authorization: 'Bearer sk-live-literal' } };
    const result = run(withServices(h.diff({ news, output: undefined })));
    await expect(result).rejects.toThrow(LitellmLiteralSecretHeaderError as never);
  });

  test('an os.environ/ reference is accepted', async () => {
    const news = { ...PROPS, headers: { Authorization: 'os.environ/UPSTREAM_KEY' } };
    const diff = await run(withServices(h.diff({ news, output: undefined })));
    expect(diff).toBeUndefined(); // output undefined -> the engine's default create
  });
});

describe('read', () => {
  test('with output undefined and nothing live, answers undefined (create)', async () => {
    const result = await run(
      withServices(
        h.read({ id: 'Endpoint', instanceId: INSTANCE_ID, olds: PROPS, output: undefined }),
      ),
    );
    expect(result).toBeUndefined();
  });
});
