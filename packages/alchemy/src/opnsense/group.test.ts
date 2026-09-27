/**
 * `Opnsense.Firewall.Group`'s `spec` against a fake OPNsense — mirrors `alias.test.ts` for the
 * interface-group family. See that file's header for what each block proves.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type * as group from '@distilled.cloud/opnsense/firewall_group';
import * as Effect from 'effect/Effect';
import { attributesOf } from './group-form.ts';
import type { GroupProps } from './group.ts';
import { spec } from './group.ts';
import { fakeFailure, fakeOpnsense, fakeOpnsenseLayer, getOnlyOrFail } from './fake-opnsense.ts';
import type { OpnsenseWriteRefused } from './policy.ts';
import { opnsenseOperations } from './resource.ts';
import { optionMap } from './wire.ts';

const asRefusal = (value: unknown) => value as OpnsenseWriteRefused;

const UUID = '33333333-3333-3333-3333-333333333333';
const GET_PATH = '/api/firewall/group/get';
const PROPS: GroupProps = {
  ifname: 'IOT_DEVICES',
  members: ['opt1', 'opt2'],
  sequence: 1,
  uuid: UUID,
};

// `liveItem` builds a `ModelIfgroupentryReadItem` — the WHOLE-MODEL `get()`'s read-shaped item,
// whose `members` decodes as an option map, not a comma string (OPNSENSE-2 — see group-form.ts).
const liveItem = (
  overrides: Partial<group.ModelIfgroupentryReadItem> = {},
): group.ModelIfgroupentryReadItem => ({
  ifname: 'IOT_DEVICES',
  members: optionMap('opt1', 'opt2'),
  sequence: '1',
  ...overrides,
});

const getResponse = (items: Record<string, group.ModelIfgroupentryReadItem>) =>
  Response.json({ group: { ifgroupentry: items } });

describe('Opnsense.Firewall.Group spec.fetchLive', () => {
  test('finds the item whose uuid is the map key, among others', async () => {
    const fake = getOnlyOrFail((url) =>
      url.pathname === GET_PATH
        ? getResponse({ 'other-uuid': liveItem({ ifname: 'OTHER' }), [UUID]: liveItem() })
        : fakeFailure(400, { errorMessage: 'unexpected request' }),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live?.ifname).toBe('IOT_DEVICES');
  });

  test('no matching uuid key is absent, not an error', async () => {
    const fake = getOnlyOrFail(() => getResponse({ 'other-uuid': liveItem() }));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 403 propagates — never folded to absent', async () => {
    const fake = fakeOpnsense(() => fakeFailure(403, { message: 'Forbidden' }));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('opnsenseOperations(spec).read — S7/S8, marker-less API', () => {
  test('cold read answers Unowned; warm read answers plain attributes', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const cold = await Effect.runPromise(
      opnsenseOperations(spec)
        .read({ olds: PROPS, output: undefined })
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(Unowned.is(cold)).toBe(true);

    const fakeWarm = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const warm = await Effect.runPromise(
      opnsenseOperations(spec)
        .read({ olds: PROPS, output: attributesOf(UUID, liveItem()) })
        .pipe(Effect.provide(fakeOpnsenseLayer(fakeWarm.fetch))),
    );
    expect(Unowned.is(warm)).toBe(false);
  });
});

describe('opnsenseOperations(spec).diff', () => {
  test('noop when the declared member set matches live, regardless of order', async () => {
    const fake = getOnlyOrFail(() =>
      getResponse({ [UUID]: liveItem({ members: optionMap('opt2', 'opt1') }) }),
    );
    const result = await Effect.runPromise(
      opnsenseOperations(spec)
        .diff(PROPS, attributesOf(UUID, liveItem({ members: optionMap('opt2', 'opt1') })))
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('update when a member was removed live', async () => {
    const fake = getOnlyOrFail(() =>
      getResponse({ [UUID]: liveItem({ members: optionMap('opt1') }) }),
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
      getResponse({ [UUID]: liveItem({ members: optionMap('opt1') }) }),
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
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(fake.seen).toHaveLength(1);
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
    expect(failure.action).toBe('delete');
    expect(fake.seen).toHaveLength(0);
  });
});
