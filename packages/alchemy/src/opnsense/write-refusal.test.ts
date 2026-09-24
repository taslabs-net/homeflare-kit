/**
 * THE PROOF: no SDK write operation — `addItem`, `setItem`, `delItem`, `toggleItem`, `set`, or
 * OPNsense's own POST-shaped search reads — is reachable from ANY handler of ANY resource in this
 * family, for ANY input. `getOnlyOrFail` (fake-opnsense.ts) fails the test itself the instant a
 * non-GET request is made, so this does not rely on inspecting what each handler happens to call
 * — it fails loudly the moment anything but a `get()` reaches the wire.
 *
 * `alias.test.ts`, `category.test.ts` and `group.test.ts` already run every scenario through this
 * same fake and would catch a write there too; this file exists so ONE place in this family
 * states the guarantee plainly, exercising the public `handlers` object each resource file wires
 * into its `Provider` (not just the lower-level `opnsenseOperations`), across every lifecycle
 * method `Provider.of` calls and against both an absent and a drifted live object.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { handlers as aliasHandlers, spec as aliasSpec } from './alias.ts';
import { handlers as categoryHandlers, spec as categorySpec } from './category.ts';
import { fakeOpnsenseLayer, getOnlyOrFail } from './fake-opnsense.ts';
import { handlers as groupHandlers, spec as groupSpec } from './group.ts';

const families = [
  {
    empty: Response.json({ alias: {} }),
    handlers: aliasHandlers,
    live: Response.json({
      alias: { aliases: { alias: { u: { content: 'x', enabled: '1', name: 'n', type: 'host' } } } },
    }),
    props: { content: 'x', name: 'n', type: 'host', uuid: 'u' },
    resourceType: aliasSpec.resourceType,
  },
  {
    empty: Response.json({ category: {} }),
    handlers: categoryHandlers,
    live: Response.json({ category: { categories: { category: { u: { name: 'n' } } } } }),
    props: { name: 'n', uuid: 'u' },
    resourceType: categorySpec.resourceType,
  },
  {
    empty: Response.json({ group: {} }),
    handlers: groupHandlers,
    live: Response.json({
      group: { ifgroupentry: { u: { ifname: 'n', members: '', sequence: '0' } } },
    }),
    props: { ifname: 'n', members: [], uuid: 'u' },
    resourceType: groupSpec.resourceType,
  },
];

describe.each(families)(
  '$resourceType — write-refusal proof',
  ({ empty, handlers, live, props }) => {
    test('list() is empty and issues no request', async () => {
      const fake = getOnlyOrFail(() => {
        throw new Error('list() must never call the wire at all');
      });
      const result = await Effect.runPromise(
        Effect.provide(handlers.list(), fakeOpnsenseLayer(fake.fetch)),
      );
      expect(result).toEqual([]);
      expect(fake.seen).toHaveLength(0);
    });

    test('reconcile against a LIVE object still only GETs, then refuses', async () => {
      const fake = getOnlyOrFail(() => live);
      const outcome = await Effect.runPromiseExit(
        Effect.provide(handlers.reconcile({ news: props as never }), fakeOpnsenseLayer(fake.fetch)),
      );
      expect(outcome._tag).toBe('Failure');
      expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    });

    test('reconcile against an ABSENT object still only GETs, then refuses', async () => {
      const fake = getOnlyOrFail(() => empty);
      const outcome = await Effect.runPromiseExit(
        Effect.provide(handlers.reconcile({ news: props as never }), fakeOpnsenseLayer(fake.fetch)),
      );
      expect(outcome._tag).toBe('Failure');
      expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    });

    test('delete makes ZERO requests and refuses', async () => {
      const fake = getOnlyOrFail(() => live);
      const outcome = await Effect.runPromiseExit(
        Effect.provide(handlers.delete({ olds: props as never }), fakeOpnsenseLayer(fake.fetch)),
      );
      expect(outcome._tag).toBe('Failure');
      expect(fake.seen).toHaveLength(0);
    });

    test('nuke is skipped, so account-wide teardown never even lists this type', () => {
      expect(handlers.nuke).toEqual({ skip: true });
    });
  },
);
