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
 *
 * ⚠️ `handlers.*` BAKES IN `CredentialsFromEnv` (resource.ts's `withCredentials`), unlike
 *   `opnsenseOperations(spec)` — see fake-opnsense.ts's warning on `fakeOpnsenseLayer`. Providing
 *   `fakeOpnsenseLayer`'s own `Credentials` layer from here does nothing: the inner `Effect.provide`
 *   already closed over that tag, so it wins. Left unaddressed, `CredentialsFromEnv` reads real
 *   `OPNSENSE_*` env vars via `EffectConfig`, finds none in CI, and `Effect.orDie`s before any
 *   request is built — `fake.seen` stays empty and `.every(...)` on an empty array is vacuously
 *   `true`. `fakeCredentialsConfigProvider` below fixes this WITHOUT touching real `process.env`
 *   (which a parallel test file could race on): it overrides the `effect/ConfigProvider` the
 *   `EffectConfig.String("OPNSENSE_*")` reads inside `CredentialsFromEnv` resolve against, which is
 *   a different tag CredentialsFromEnv never shadows — proved against this exact fake/real pattern
 *   before landing here. Every "only GETs" test below also asserts `fake.seen` has exactly the
 *   one GET `fetchLive` issues, so a run that silently makes zero requests (or a future
 *   double-GET regression) fails loudly instead of passing on an under-checked `.every()`.
 *
 * ⚠️ THIS FIX HAS ONE INVARIANT: `CredentialsFromEnv` (distilled-opnsense's `credentials.ts`) must
 *   keep resolving `OPNSENSE_*` through the AMBIENT `ConfigProvider` rather than one it pins
 *   itself. If it ever starts providing its own `ConfigProvider` — the way it already closes over
 *   the `Credentials` tag via `withCredentials` — this override would be shadowed the same way
 *   `fakeOpnsenseLayer`'s `Credentials` layer is today, and the vacuous-pass bug this file exists
 *   to prevent would return silently.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ConfigProvider from 'effect/ConfigProvider';
import { handlers as aliasHandlers, spec as aliasSpec } from './alias.ts';
import { handlers as categoryHandlers, spec as categorySpec } from './category.ts';
import {
  FAKE_BASE,
  FAKE_KEY,
  FAKE_SECRET,
  fakeOpnsenseLayer,
  getOnlyOrFail,
} from './fake-opnsense.ts';
import { handlers as groupHandlers, spec as groupSpec } from './group.ts';

/**
 * Overrides the `ConfigProvider` `CredentialsFromEnv`'s `EffectConfig.String("OPNSENSE_*")`
 * resolves against, so `handlers.*` (which bakes in real env-var credentials resolution) gets
 * the same placeholder values `fakeOpnsenseLayer`'s default `Credentials` layer uses — without
 * ever reading or writing real `process.env`.
 */
const fakeCredentialsConfigProvider = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPNSENSE_API_KEY: FAKE_KEY,
    OPNSENSE_API_SECRET: FAKE_SECRET,
    OPNSENSE_URL: FAKE_BASE,
  }),
);

/** `fakeOpnsenseLayer` plus the env override `handlers.*` needs — see the file header. */
const fakeHandlersLayer = (fetchFn: typeof globalThis.fetch) =>
  Layer.mergeAll(fakeOpnsenseLayer(fetchFn), fakeCredentialsConfigProvider);

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
        Effect.provide(handlers.reconcile({ news: props as never }), fakeHandlersLayer(fake.fetch)),
      );
      expect(outcome._tag).toBe('Failure');
      // ⚠️ Not sufficient alone — `.every()` on an empty array is vacuously true. See the file
      //   header: without `fakeHandlersLayer`'s ConfigProvider override this assertion never ran
      //   a single request, because `CredentialsFromEnv` died first. Exactly 1, not just > 0:
      //   `fetchLive` (alias.ts/category.ts/group.ts) issues one `get()` — matches
      //   `alias.test.ts`'s own `toHaveLength(1)` and also catches a future double-GET regression.
      expect(fake.seen).toHaveLength(1);
      expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
    });

    test('reconcile against an ABSENT object still only GETs, then refuses', async () => {
      const fake = getOnlyOrFail(() => empty);
      const outcome = await Effect.runPromiseExit(
        Effect.provide(handlers.reconcile({ news: props as never }), fakeHandlersLayer(fake.fetch)),
      );
      expect(outcome._tag).toBe('Failure');
      expect(fake.seen).toHaveLength(1);
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
