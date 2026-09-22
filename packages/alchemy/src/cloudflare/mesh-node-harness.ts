/**
 * MeshNodeProvider's handlers, called the way the engine calls them, over the fake Cloudflare in
 * fake-mesh.ts — and `engine`, which runs Alchemy's real plan/apply over the same fake. Shared by
 * mesh-node.test.ts, mesh-node-edges.test.ts and mesh-node-policy.test.ts.
 *
 * ⛔ TEST-ONLY, like fake-mesh.ts: no provider imports this file and it is not on the barrel.
 */
import { apply } from 'alchemy/Apply';
import * as Plan from 'alchemy/Plan';
import { type CompiledStack, make as makeStack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import * as State from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { type FakeMesh, fakeProviderLayer } from './fake-mesh.ts';
import { MeshNode, MeshNodeProvider } from './mesh-node.ts';
import type { MeshNodeAttributes, MeshNodeProps } from './mesh-node-form.ts';

export const ids = { fqn: 'stack/door', id: 'door', instanceId: 'i-1' };
export const extra = { bindings: [] as never, session: undefined as never };

export type P = Effect.Success<typeof MeshNode.Provider>;

export const handler = <F>(name: string, fn: F | undefined): F => {
  if (fn === undefined) throw new Error(`provider has no ${name} handler`);
  return fn;
};

/** Build the provider over the fake (as `accountId`'s environment) and hand it to `use`. */
export const run = <A, E>(fake: FakeMesh, use: (p: P) => Effect.Effect<A, E>, accountId?: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* MeshNode.Provider);
    }).pipe(
      Effect.provide(
        MeshNodeProvider().pipe(Layer.provideMerge(fakeProviderLayer(fake, accountId))),
      ),
    ),
  );

export const reconcile = (p: P, news: MeshNodeProps, output?: MeshNodeAttributes) =>
  p.reconcile({ ...ids, ...extra, news, olds: undefined, output });

export const read = (p: P, olds: MeshNodeProps, output?: MeshNodeAttributes) =>
  handler('read', p.read)({ ...ids, olds, output });

export const diff = (p: P, news: MeshNodeProps, olds: MeshNodeProps, output: MeshNodeAttributes) =>
  handler(
    'diff',
    p.diff,
  )({
    ...ids,
    news,
    olds,
    newBindings: [] as never,
    oldBindings: [] as never,
    output,
  });

/** A stored attribute set for a node that may or may not exist in the fake. */
export const stored = (
  accountId: string,
  over: Partial<MeshNodeAttributes> = {},
): MeshNodeAttributes => ({
  id: 'x',
  accountId,
  name: 'door-a',
  status: undefined,
  ha: false,
  ...over,
});

export const tokenReads = (fake: FakeMesh) =>
  fake.seen.filter((s) => s.path.endsWith('/token')).length;

/** The writes the fake saw, in order: `['POST', 'DELETE', …]`. */
export const writes = (fake: FakeMesh) =>
  fake.seen.filter((s) => s.method !== 'GET').map((s) => s.method);

type Rows = Record<string, Record<string, Record<string, State.ResourceState>>>;

/**
 * ★ THE REAL ENGINE, NOT A MODEL OF IT: Alchemy's own `Plan.make` + `apply` over an in-memory
 *   state store, which is what its Test harness's scratch stacks run (Test/Core.ts
 *   `scratchStack`), minus the profile, config and telemetry layers a fake Cloudflare does not
 *   need. Removal policy lives in the engine, so only this can show what it does to a replace.
 * ⚠️ `FetchHttpClient.Fetch` IS READ PER REQUEST, from the fiber running the engine, so it is
 *   provided around the whole deploy. Provided only under the provider layer, the requests went
 *   to the real `fetch` (measured 2026-09-21: ENOTFOUND api.example.com, the RFC 2606 host, so
 *   no API answered — but a real DNS lookup went out).
 */
export const engine = (fake: FakeMesh) => {
  const rows: Rows = {};
  const state = Layer.succeed(State.State, State.InMemoryService(rows));
  const providers = MeshNodeProvider().pipe(Layer.provide(fakeProviderLayer(fake)));
  const deploy = <A, E, R>(declare: Effect.Effect<A, E, R>) =>
    Effect.runPromiseExit(
      declare.pipe(
        makeStack({ name: 'mesh', providers, state }) as never,
        Effect.flatMap((compiled: CompiledStack) =>
          Plan.make(compiled).pipe(Effect.flatMap(apply), Effect.provide(compiled.services)),
        ),
        Effect.provide(Layer.succeed(Stage, 'test')),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
      ) as Effect.Effect<unknown, unknown>,
    );
  return {
    deploy,
    /** The stored row's status (`created`, `replacing`, …), or `undefined` when there is none. */
    status: (fqn: string) => rows['mesh']?.['test']?.[fqn]?.status,
    /** ★ What `alchemy state rm` does ("Delete state records without deleting cloud resources"). */
    forget: (fqn: string) => {
      delete rows['mesh']?.['test']?.[fqn];
    },
  };
};

/** The failure sentence of a deploy, or `''` when it succeeded. */
export const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '';
