/**
 * `Opnsense.Firewall.Alias`'s `spec` against a fake OPNsense, proving the real distilled wire
 * path — path assembly, JSON decode and typed-error propagation — exercised through
 * `@distilled.cloud/opnsense/firewall_alias`'s real `get`, never re-implemented here. Also proves
 * `opnsenseOperations(spec)`'s read/diff/reconcile/destroy flow (resource.ts), the exact object
 * `opnsenseHandlers` wraps into `OpnsenseFirewallAliasProvider`. Mirrors
 * `../discord/guild-application-command.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type * as alias from '@distilled.cloud/opnsense/firewall_alias';
import * as Effect from 'effect/Effect';
import { attributesOf } from './alias-form.ts';
import type { AliasProps } from './alias.ts';
import { spec } from './alias.ts';
import { fakeFailure, fakeOpnsense, fakeOpnsenseLayer, getOnlyOrFail } from './fake-opnsense.ts';
import type { OpnsenseWriteRefused } from './policy.ts';
import { opnsenseOperations } from './resource.ts';
import { optionMap } from './wire.ts';

/** `Effect.flip`'s promise resolves to the union of every error this spec can raise; every
 * refusal test below is asserting specifically on the `OpnsenseWriteRefused` member. */
const asRefusal = (value: unknown) => value as OpnsenseWriteRefused;

const UUID = '11111111-1111-1111-1111-111111111111';
const GET_PATH = '/api/firewall/alias/get';
const PROPS: AliasProps = {
  content: '10.20.10.1',
  name: 'homeflare_edge',
  type: 'host',
  uuid: UUID,
};

// `liveItem` builds a `ModelAliasReadItem` — the WHOLE-MODEL `get()`'s read-shaped item, whose
// `content`/`type` decode as option maps, not strings (OPNSENSE-2 — see alias-form.ts).
const liveItem = (overrides: Partial<alias.ModelAliasReadItem> = {}): alias.ModelAliasReadItem => ({
  content: optionMap('10.20.10.1'),
  enabled: '1',
  name: 'homeflare_edge',
  type: optionMap('host'),
  ...overrides,
});

const getResponse = (items: Record<string, alias.ModelAliasReadItem>) =>
  Response.json({ alias: { aliases: { alias: items } } });

describe('Opnsense.Firewall.Alias spec.fetchLive', () => {
  test('finds the item whose uuid is the map key, among others', async () => {
    const fake = getOnlyOrFail((url) =>
      url.pathname === GET_PATH
        ? getResponse({ 'other-uuid': liveItem({ name: 'other' }), [UUID]: liveItem() })
        : fakeFailure(400, { errorMessage: 'unexpected request' }),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live?.name).toBe('homeflare_edge');
    expect(fake.seen).toHaveLength(1);
  });

  test('no matching uuid key is absent, not an error', async () => {
    const fake = getOnlyOrFail(() => getResponse({ 'other-uuid': liveItem() }));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('an empty model (no aliases section at all) is absent, not a crash', async () => {
    const fake = getOnlyOrFail(() => Response.json({ alias: {} }));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 401 propagates — never folded to absent (the live bug this family avoids)', async () => {
    const fake = fakeOpnsense(() => fakeFailure(401, { message: 'Unauthorized' }));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('opnsenseOperations(spec).read — S7/S8, marker-less API', () => {
  test('cold read (no output) answers Unowned', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const attrs = await Effect.runPromise(
      opnsenseOperations(spec)
        .read({ olds: PROPS, output: undefined })
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(attrs).toBeDefined();
    expect(Unowned.is(attrs)).toBe(true);
  });

  test('warm read (output already ours) answers plain attributes', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const priorOutput = attributesOf(UUID, liveItem());
    const attrs = await Effect.runPromise(
      opnsenseOperations(spec)
        .read({ olds: PROPS, output: priorOutput })
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(Unowned.is(attrs)).toBe(false);
  });

  test('absent is undefined either way', async () => {
    const fake = getOnlyOrFail(() => getResponse({}));
    const attrs = await Effect.runPromise(
      opnsenseOperations(spec)
        .read({ olds: PROPS, output: undefined })
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(attrs).toBeUndefined();
  });
});

describe('opnsenseOperations(spec).diff', () => {
  test('noop when the declaration already matches live', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const result = await Effect.runPromise(
      opnsenseOperations(spec)
        .diff(PROPS, attributesOf(UUID, liveItem()))
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('update when live content drifted from the declaration — never from a read error', async () => {
    const fake = getOnlyOrFail(() =>
      getResponse({ [UUID]: liveItem({ content: optionMap('10.20.10.9') }) }),
    );
    const result = await Effect.runPromise(
      opnsenseOperations(spec)
        .diff(PROPS, attributesOf(UUID, liveItem()))
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'update' });
  });
});

describe('opnsenseOperations(spec).reconcile and destroy — the read-only policy', () => {
  test('reconcile observes with one GET, then refuses — never a write', async () => {
    const fake = getOnlyOrFail(() =>
      getResponse({ [UUID]: liveItem({ content: optionMap('drifted') }) }),
    );
    const failure = asRefusal(
      await Effect.runPromise(
        Effect.flip(
          opnsenseOperations(spec)
            .reconcile(PROPS)
            .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
        ),
      ),
    );
    expect(failure._tag).toBe('OpnsenseWriteRefused');
    expect(failure.action).toBe('update');
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.method).toBe('GET');
  });

  test('reconcile against an absent uuid reports it would have created', async () => {
    const fake = getOnlyOrFail(() => getResponse({}));
    const failure = asRefusal(
      await Effect.runPromise(
        Effect.flip(
          opnsenseOperations(spec)
            .reconcile(PROPS)
            .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
        ),
      ),
    );
    expect(failure.action).toBe('create');
  });

  // ⛔ THE ONE CASE THAT MATTERS MOST: a genuine failure of the observe step (auth, network,
  //   a vendor error) must propagate AS ITSELF, never get swallowed and re-reported as the
  //   write-refusal — the same "only a genuine not-found may mean absent; every other error
  //   fails loudly" rule this family exists to honour, extended to reconcile's own observe.
  test('reconcile propagates a genuine read failure — never masks it as the write-refusal', async () => {
    const fake = fakeOpnsense(() => fakeFailure(401, { message: 'Unauthorized' }));
    const failure = await Effect.runPromise(
      Effect.flip(
        opnsenseOperations(spec)
          .reconcile(PROPS)
          .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('Unauthorized');
    expect(failure._tag).not.toBe('OpnsenseWriteRefused');
  });

  test('delete refuses unconditionally, with zero requests', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const failure = asRefusal(
      await Effect.runPromise(
        Effect.flip(
          opnsenseOperations(spec)
            .destroy(PROPS)
            .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
        ),
      ),
    );
    expect(failure._tag).toBe('OpnsenseWriteRefused');
    expect(failure.action).toBe('delete');
    expect(fake.seen).toHaveLength(0);
  });
});
