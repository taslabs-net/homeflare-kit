/**
 * The watched providers (spy.ts) and the verdict (rows.ts), without an engine.
 *
 * ⛔ THE REFUSALS ARE THE POINT. A verifier that could reach `reconcile` is a deploy with a
 *   reassuring name; these pin that every write path dies with the same message, on a direct
 *   service, inside a collection, and on a dual registration's per-mode variant.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type { ProviderService } from 'alchemy/Provider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { changedFields, rowsOf } from './rows.ts';
import { type Observations, WRITE_REFUSED, spyContext } from './spy.ts';

const calls: string[] = [];
const service = (): ProviderService =>
  ({
    delete: () => Effect.sync(() => void calls.push('delete')),
    diff: () => Effect.succeed({ action: 'update' }),
    precreate: () => Effect.sync(() => calls.push('precreate')),
    read: () => Effect.succeed(Unowned({ comment: 'live', name: 'a' })),
    reconcile: () => Effect.sync(() => calls.push('reconcile')),
  }) as unknown as ProviderService;

const input = { fqn: 'a', id: 'a', instanceId: 'i-1', news: {}, olds: {}, output: undefined };

const dies = async (effect: unknown) => {
  const exit = await Effect.runPromiseExit(effect as Effect.Effect<unknown, unknown>);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(String(Exit.isFailure(exit) ? exit.cause : '')).toContain(WRITE_REFUSED);
};

const watched = (value: unknown, key = 'Test.Thing') => {
  const seen: Observations = new Map();
  const context = spyContext(Context.makeUnsafe(new Map([[key, value]])), seen);
  return { seen, service: context.mapUnsafe.get(key) as ProviderService & Record<string, unknown> };
};

describe('spyContext', () => {
  test('every write path dies and nothing reaches the provider', async () => {
    const { service: spied } = watched(service());
    await dies(spied.reconcile(input as never));
    await dies(spied.delete(input as never));
    await dies(spied.precreate?.(input as never));
    expect(calls).toEqual([]);
  });

  test('read and diff pass through and are recorded, Unowned included', async () => {
    const { seen, service: spied } = watched(service());
    await Effect.runPromise(spied.read?.(input as never) as Effect.Effect<unknown>);
    await Effect.runPromise(spied.diff?.(input as never) as Effect.Effect<unknown>);
    expect(seen.get('a')?.read?.answer).toBe('unowned');
    expect(seen.get('a')?.read?.attributes).toEqual({ comment: 'live', name: 'a' });
    expect(seen.get('a')?.diff?.answer).toBe('update');
  });

  test('a collection and a dual registration are watched too', async () => {
    const collection = {
      get: () => service(),
      kind: 'ProviderCollection',
      providers: { 'Test.Thing': service() },
    };
    const inner = watched(collection, 'Test/Collection').service as unknown as {
      get: (type: string) => ProviderService;
    };
    await dies(inner.get('Test.Thing').reconcile(input as never));

    const dual = {
      ...service(),
      modes: { live: Effect.sync(service), local: Effect.sync(service) },
    };
    const modes = (watched(dual).service as ProviderService).modes;
    const live = await Effect.runPromise(modes?.live as Effect.Effect<ProviderService>);
    await dies(live.delete(input as never));
    expect(calls).toEqual([]);
  });

  test('anything that is not a provider is handed over untouched', () => {
    const value = { some: 'service' };
    expect(watched(value, 'Other').service).toBe(value as never);
  });
});

describe('rows', () => {
  test('changedFields compares declared, same-named fields by value and names them only', () => {
    expect(
      changedFields(
        { comment: 'new', name: 'a', size: 3, target: { mount: 'm' }, unset: undefined },
        { comment: 'old', name: 'a', size: 3, unset: 'x' },
      ),
    ).toEqual(['comment']);
    expect(changedFields(undefined, { a: 1 })).toEqual([]);
  });

  test('a noop row with state and no diff is trusted; an adopted one is not', () => {
    const seen: Observations = new Map([
      ['kept', { diff: { answer: 'none', news: {} } }],
      ['new', { diff: { answer: 'none', news: {} } }],
    ]);
    const plan = {
      deletions: {},
      resources: {
        kept: { action: 'noop', resource: { Type: 'T' } },
        new: { action: 'adopted', resource: { Type: 'T' } },
      },
    };
    const rows = rowsOf(plan, new Set(['kept']), seen, true);
    expect(rows.map((row) => [row.fqn, row.ok])).toEqual([
      ['kept', true],
      ['new', false],
    ]);
  });

  test('a stack task that runs is reported in both modes; one that does not, only with all', () => {
    const plan = {
      actions: {
        idle: { action: 'noop', def: { Type: 'Task' } },
        seed: { action: 'run', def: { Type: 'Task' } },
      },
      deletions: {},
      resources: {},
    };
    expect(rowsOf(plan, new Set(), new Map(), false).map((row) => [row.fqn, row.ok])).toEqual([
      ['seed', false],
    ]);
    expect(rowsOf(plan, new Set(), new Map(), true).map((row) => row.fqn)).toEqual([
      'idle',
      'seed',
    ]);
  });

  test('a noop adoption that brings a binding is not a no-op', () => {
    const seen: Observations = new Map([['worker', { diff: { answer: 'noop', news: {} } }]]);
    const node = { action: 'adopted', bindings: [{ action: 'create' }], resource: { Type: 'W' } };
    const [row] = rowsOf({ deletions: {}, resources: { worker: node } }, new Set(), seen, false);
    expect(row).toMatchObject({ bindings: 1, ok: false });
    expect(row?.why).toContain('binding');
  });
});
