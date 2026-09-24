/**
 * `Opnsense.Firewall.Category`'s `spec` against a fake OPNsense — mirrors `alias.test.ts` for the
 * category family. See that file's header for what each block proves.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type * as category from '@distilled.cloud/opnsense/firewall_category';
import * as Effect from 'effect/Effect';
import { attributesOf } from './category-form.ts';
import type { CategoryProps } from './category.ts';
import { spec } from './category.ts';
import { fakeFailure, fakeOpnsense, fakeOpnsenseLayer, getOnlyOrFail } from './fake-opnsense.ts';
import type { OpnsenseWriteRefused } from './policy.ts';
import { opnsenseOperations } from './resource.ts';

const asRefusal = (value: unknown) => value as OpnsenseWriteRefused;

const UUID = '22222222-2222-2222-2222-222222222222';
const GET_PATH = '/api/firewall/category/get';
const PROPS: CategoryProps = { name: 'vpn-clients', uuid: UUID };

const liveItem = (overrides: Partial<category.CategoryItem> = {}): category.CategoryItem => ({
  name: 'vpn-clients',
  ...overrides,
});

const getResponse = (items: Record<string, category.CategoryItem>) =>
  Response.json({ category: { categories: { category: items } } });

describe('Opnsense.Firewall.Category spec.fetchLive', () => {
  test('finds the item whose uuid is the map key, among others', async () => {
    const fake = getOnlyOrFail((url) =>
      url.pathname === GET_PATH
        ? getResponse({ 'other-uuid': liveItem({ name: 'other' }), [UUID]: liveItem() })
        : fakeFailure(400, { errorMessage: 'unexpected request' }),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live?.name).toBe('vpn-clients');
  });

  test('no matching uuid key is absent, not an error', async () => {
    const fake = getOnlyOrFail(() => getResponse({ 'other-uuid': liveItem() }));
    const live = await Effect.runPromise(
      spec.fetchLive(PROPS).pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  // ⚠️ 403, NOT 500: a 5xx is a transient-error tag the SDK's default retry policy (retry.ts)
  //   retries with backoff (S26) — a real, useful behaviour, but one that would make this test
  //   itself slow. 403 (`Forbidden`, OPNsense's own auth-gate shape — protocol.ts) is not
  //   retried, so the propagation is provable in one request.
  test('a 403 propagates — never folded to absent (the live bug this family avoids)', async () => {
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
  test('noop when the declaration already matches live', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem() }));
    const result = await Effect.runPromise(
      opnsenseOperations(spec)
        .diff(PROPS, attributesOf(UUID, liveItem()))
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'noop' });
  });

  test('update when the live color drifted', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem({ color: 'FF0000' }) }));
    const result = await Effect.runPromise(
      opnsenseOperations(spec)
        .diff({ ...PROPS, color: '0000FF' }, attributesOf(UUID, liveItem({ color: '0000FF' })))
        .pipe(Effect.provide(fakeOpnsenseLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'update' });
  });
});

describe('opnsenseOperations(spec).reconcile and destroy — the read-only policy', () => {
  test('reconcile observes with one GET, then refuses — never a write', async () => {
    const fake = getOnlyOrFail(() => getResponse({ [UUID]: liveItem({ name: 'drifted' }) }));
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
