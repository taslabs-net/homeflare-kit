/**
 * `unifiOperations` in isolation, against a synthetic spec — no real UniFi SDK, no HTTP. Proves
 * the read-only engine's own contract: `Unowned` on a cold read (H1), `noop`/`update` diff,
 * `reconcile` succeeding with ZERO write calls on an exact match (the H6 forced post-adoption
 * call this engine has to survive without writing), and a typed `UnifiWriteRefused` — never a
 * silent success, never a raw SDK write — every other time `reconcile` or `delete` runs.
 *
 * `network.test.ts`/`firewall-zone.test.ts` prove the same contract again against the REAL SDK
 * and a fake HTTP server, and additionally prove that no non-`GET` request is ever sent.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type { UnifiNetworkOpContext } from '@distilled.cloud/unifi-network/Protocol';
import * as Effect from 'effect/Effect';
import { fakeUnifiLayer } from './fake-unifi.ts';
import { UnifiWriteRefused } from './policy.ts';
import { type UnifiSpec, unifiOperations } from './resource.ts';

interface WidgetProps {
  id: string;
  value: number;
}
type WidgetLive = WidgetProps;
type WidgetAttrs = WidgetProps;

/** `live: undefined` models a declared object nothing on the site matches. */
const specFor = (
  live: WidgetLive | undefined,
): UnifiSpec<WidgetProps, WidgetLive, WidgetAttrs, never> => ({
  type: 'Test.Widget',
  describe: (props) => `widgets/${props.id}`,
  fetchLive: () => Effect.succeed(live),
  attributes: (l) => l,
  matches: (attrs, props) => attrs.value === props.value,
});

const MATCH: WidgetProps = { id: 'w1', value: 1 };
const DRIFTED_LIVE: WidgetLive = { id: 'w1', value: 99 };

/**
 * `UnifiSpec`'s `fetchLive` is typed against the real `UnifiNetworkOpContext` (`resource.ts`'s
 * own header explains why the engine is not generic over it) even though `specFor` above never
 * touches HTTP — so every run here still needs A layer satisfying that context. This one fails
 * the test outright if anything ever calls it, which is itself part of the write-refusal proof:
 * the synthetic spec has no operation that could, but if one ever did, this is not a silent pass.
 */
const unreachableFetch = (() => {
  throw new Error('resource.test.ts: unexpected HTTP call from a spec with no HTTP operations');
}) as unknown as typeof globalThis.fetch;

const run = <A, E>(effect: Effect.Effect<A, E, UnifiNetworkOpContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(fakeUnifiLayer(unreachableFetch))));

const refusal = async (
  effect: Effect.Effect<unknown, UnifiWriteRefused, UnifiNetworkOpContext>,
) => {
  const failure = await run(Effect.flip(effect));
  expect(failure).toBeInstanceOf(UnifiWriteRefused);
  return failure;
};

describe('unifiOperations.readHandler', () => {
  test('cold read (no persisted output) of a match answers Unowned', async () => {
    const attrs = await run(
      unifiOperations(specFor(MATCH)).readHandler({ olds: MATCH, output: undefined }),
    );
    expect(Unowned.is(attrs)).toBe(true);
    expect(attrs).toEqual(MATCH);
  });

  test('warm read (persisted output says ours already) answers plain attributes', async () => {
    const attrs = await run(
      unifiOperations(specFor(MATCH)).readHandler({ olds: MATCH, output: MATCH }),
    );
    expect(Unowned.is(attrs)).toBe(false);
    expect(attrs).toEqual(MATCH);
  });

  test('a genuinely absent object answers undefined either way', async () => {
    const attrs = await run(
      unifiOperations(specFor(undefined)).readHandler({ olds: MATCH, output: MATCH }),
    );
    expect(attrs).toBeUndefined();
  });
});

describe('unifiOperations.diff', () => {
  test('no persisted output defers to the engine default (undefined)', async () => {
    const diff = await run(unifiOperations(specFor(MATCH)).diff(MATCH, undefined));
    expect(diff).toBeUndefined();
  });

  test('declared props match live -- noop', async () => {
    const diff = await run(unifiOperations(specFor(MATCH)).diff(MATCH, MATCH));
    expect(diff).toEqual({ action: 'noop' });
  });

  test('live object drifted from the declaration -- update, never silently absorbed', async () => {
    const diff = await run(unifiOperations(specFor(DRIFTED_LIVE)).diff(MATCH, MATCH));
    expect(diff).toEqual({ action: 'update' });
  });

  test('live object vanished since it was adopted -- update, never a quiet noop', async () => {
    const diff = await run(unifiOperations(specFor(undefined)).diff(MATCH, MATCH));
    expect(diff).toEqual({ action: 'update' });
  });
});

describe('unifiOperations.reconcile', () => {
  test('exact match: zero write calls (the spec has none), returns live attributes -- H6', async () => {
    const attrs = await run(unifiOperations(specFor(MATCH)).reconcile(MATCH));
    expect(attrs).toEqual(MATCH);
  });

  test('missing live object refuses "create", never fabricates one', async () => {
    const failure = await refusal(unifiOperations(specFor(undefined)).reconcile(MATCH));
    expect(failure.action).toBe('create');
    expect(failure.type).toBe('Test.Widget');
    expect(failure.identity).toBe('widgets/w1');
  });

  test('drifted live object refuses "update", never converges by writing', async () => {
    const failure = await refusal(unifiOperations(specFor(DRIFTED_LIVE)).reconcile(MATCH));
    expect(failure.action).toBe('update');
  });
});

describe('unifiOperations.destroy', () => {
  test('always refuses "delete" -- the spec has no destroy operation at all', async () => {
    const failure = await refusal(unifiOperations(specFor(MATCH)).destroy(MATCH));
    expect(failure.action).toBe('delete');
  });
});
