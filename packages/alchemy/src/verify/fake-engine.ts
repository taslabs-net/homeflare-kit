/**
 * A test-only stack: Alchemy's real Plan and Apply over an in-memory state store, and a fake family
 * whose "cloud" is a Map — so the verifier runs against the engine's own plans with no network.
 *
 * ★ THE ENGINE, NOT A HAND-BUILT PLAN. What the verifier claims is about alchemy beta.79: that an
 *   adopted row's `diff` answer is lost to `forceUpdateAfterAdoption`, that Apply then reconciles
 *   it, and that a watched plan never writes. openbao/fake-stack.ts measured the same engine for
 *   the Bao families; this one is family-neutral and records every provider call in order.
 * ⛔ TEST-ONLY. No provider imports this file.
 */
import * as Alchemy from 'alchemy';
import { AdoptPolicy, Unowned } from 'alchemy/AdoptPolicy';
import { provideFreshArtifactStore } from 'alchemy/Artifacts';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { type AdoptReport, type VerifyOptions, verifySession } from './verify.ts';

export interface ThingProps {
  name: string;
  comment?: string;
}
export interface ThingAttributes {
  name: string;
  comment: string;
}

export interface Thing extends Alchemy.Resource<'Test.Thing', ThingProps, ThingAttributes> {}
export const Thing = Alchemy.Resource<Thing>('Test.Thing');

/** The same object with no `diff`, like a provider that never wrote one. */
export interface Blind extends Alchemy.Resource<'Test.Blind', ThingProps, ThingAttributes> {}
export const Blind = Alchemy.Resource<Blind>('Test.Blind');

/**
 * The same object with a `diff` that compares the RECORDED props with the declaration and never
 * the live object — the shape of Alchemy's own `Cloudflare.R2Bucket` diff (beta.79
 * Cloudflare/R2/Bucket.ts: `olds.domains` against `news.domains`). recheck.ts exists for it.
 */
export interface Recorded extends Alchemy.Resource<'Test.Recorded', ThingProps, ThingAttributes> {}
export const Recorded = Alchemy.Resource<Recorded>('Test.Recorded');

/** The fake cloud: what exists, what is someone else's, and every call made to it, in order. */
export interface Cloud {
  readonly live: Map<string, string>;
  readonly unowned: Set<string>;
  readonly calls: string[];
}

export const cloudOf = (live: Record<string, string> = {}): Cloud => ({
  calls: [],
  live: new Map(Object.entries(live)),
  unowned: new Set(),
});

/** Every call that would change the cloud. */
export const writesOf = (cloud: Cloud): string[] =>
  cloud.calls.filter((call) => call.startsWith('reconcile') || call.startsWith('delete'));

const lifecycle = (cloud: Cloud) => ({
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ThingProps }) =>
    Effect.sync(() => {
      cloud.calls.push(`read ${olds.name}`);
      const comment = cloud.live.get(olds.name);
      if (comment === undefined) return undefined;
      const found = { comment, name: olds.name };
      return cloud.unowned.has(olds.name) ? Unowned(found) : found;
    }),
  reconcile: ({ news }: { news: ThingProps }) =>
    Effect.sync(() => {
      cloud.calls.push(`reconcile ${news.name}`);
      cloud.live.set(news.name, news.comment ?? '');
      return { comment: news.comment ?? '', name: news.name };
    }),
  delete: ({ olds }: { olds: ThingProps }) =>
    Effect.sync(() => {
      cloud.calls.push(`delete ${olds.name}`);
      cloud.live.delete(olds.name);
    }),
});

/** Both fake families over `cloud` — also what tests/fixtures/verify-stack.ts registers. */
export const thingProviders = (cloud: Cloud) =>
  Layer.mergeAll(
    Provider.effect(
      Thing,
      Effect.succeed(
        Thing.Provider.of({
          ...lifecycle(cloud),
          diff: ({ news, output }) =>
            Effect.sync(() => {
              if (output === undefined || !isResolved(news)) return undefined;
              cloud.calls.push(`diff ${news.name}`);
              return cloud.live.get(news.name) === (news.comment ?? '')
                ? ({ action: 'noop' } as const)
                : ({ action: 'update' } as const);
            }),
        }),
      ),
    ),
    Provider.effect(Blind, Effect.succeed(Blind.Provider.of(lifecycle(cloud)))),
    Provider.effect(
      Recorded,
      Effect.succeed(
        Recorded.Provider.of({
          ...lifecycle(cloud),
          diff: ({ news, olds }) =>
            Effect.sync(() => {
              if (!isResolved(news)) return undefined;
              cloud.calls.push(`diff ${news.name}`);
              return (olds.comment ?? '') === (news.comment ?? '')
                ? ({ action: 'noop' } as const)
                : ({ action: 'update' } as const);
            }),
        }),
      ),
    ),
  );

/** A stack body: resource declarations, as an `alchemy.run.ts` would write them. */
export type Body = Effect.Effect<unknown, unknown, unknown>;

type Compiled = { readonly name: string; readonly stage: string; readonly services: never };
type PlanView = { readonly resources: Readonly<Record<string, { readonly action: string }>> };

export interface FakeEngine {
  /** Plan and apply `body`, as `alchemy deploy --adopt` would; resolves to the planned actions. */
  readonly deploy: (body: Body) => Promise<Record<string, string>>;
  /** Verify `body` against what the earlier deploys recorded. */
  readonly verify: (body: Body, options?: VerifyOptions) => Promise<AdoptReport>;
  /**
   * Every state row the store holds, as JSON — what a Postgres store would persist. ★ For tests
   * that must prove a value NEVER reaches state (proxmox/pbs-notification-target-state.test.ts).
   */
  readonly stored: () => string;
}

/**
 * One stack over one state store and any providers, shared by every call — a family's own test
 * hands in its real provider over a fake transport (proxmox/ceph-pool-adopt.test.ts).
 * ⚠️ THE CASTS ARE AT THE ENGINE'S TYPED BOUNDARY — openbao/fake-stack.ts has the reasoning.
 */
export const engineOver = <ROut, E, RIn>(layer: Layer.Layer<ROut, E, RIn>): FakeEngine => {
  const rows: NonNullable<Parameters<typeof Alchemy.inMemoryState>[0]> = {};
  const state = Alchemy.inMemoryState(rows);
  const stack = Alchemy.Stack as unknown as (
    name: string,
    options: { providers: typeof layer; state: typeof state },
    body: Body,
  ) => Effect.Effect<Compiled, unknown, never>;
  const plan = Alchemy.Plan.make as unknown as (c: Compiled) => Effect.Effect<PlanView, unknown>;
  const apply = Alchemy.apply as unknown as (planned: PlanView) => Effect.Effect<unknown, unknown>;

  const run = <A>(body: Body, next: (compiled: Compiled) => Effect.Effect<A, unknown, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const compiled = yield* stack('VerifyStack', { providers: layer, state }, body);
        return yield* next(compiled).pipe(Effect.provide(Layer.succeedContext(compiled.services)));
      }).pipe(
        Effect.provideService(AdoptPolicy, true),
        Effect.provideService(Alchemy.Stage, 'test'),
        Effect.provide(state),
        Effect.scoped,
      ) as Effect.Effect<A>,
    );

  return {
    stored: () => JSON.stringify(rows),
    deploy: (body) =>
      run(body, (compiled) =>
        Effect.gen(function* () {
          const planned = yield* plan(compiled);
          yield* apply(planned);
          return Object.fromEntries(
            Object.entries(planned.resources).map(([fqn, node]) => [fqn, node.action]),
          );
        }).pipe(provideFreshArtifactStore),
      ),
    verify: (body, options) =>
      run(body, (compiled) =>
        verifySession({ context: compiled.services, stack: compiled as never }, options),
      ),
  };
};

/** The fake family over `cloud`. */
export const fakeEngine = (cloud: Cloud): FakeEngine => engineOver(thingProviders(cloud));
