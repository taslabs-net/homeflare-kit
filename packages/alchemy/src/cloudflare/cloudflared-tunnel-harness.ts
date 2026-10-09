/**
 * CloudflaredTunnelProvider's handlers, called the way the engine calls them, over the fake
 * Cloudflare in fake-tunnel.ts — and `engine`, which runs Alchemy's real plan/apply over the same
 * fake and exposes the state rows it wrote. Shared by cloudflared-tunnel.test.ts,
 * cloudflared-tunnel-edges.test.ts and cloudflared-tunnel-state.test.ts.
 *
 * ⛔ TEST-ONLY, like fake-tunnel.ts: no provider imports this file and it is not on the barrel.
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
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { CloudflaredTunnel, CloudflaredTunnelProvider } from './cloudflared-tunnel.ts';
import type {
  CloudflaredTunnelAttributes,
  CloudflaredTunnelProps,
} from './cloudflared-tunnel-form.ts';
import { fakeProviderLayer } from './fake-mesh.ts';
import type { FakeTunnels } from './fake-tunnel.ts';

export const ids = { fqn: 'stack/admin', id: 'admin', instanceId: 'i-1' };
export const extra = { bindings: [] as never, session: undefined as never };

export type P = Effect.Success<typeof CloudflaredTunnel.Provider>;

export const handler = <F>(name: string, fn: F | undefined): F => {
  if (fn === undefined) throw new Error(`provider has no ${name} handler`);
  return fn;
};

/** Build the provider over the fake (as `accountId`'s environment) and hand it to `use`. */
export const run = <A, E>(
  fake: FakeTunnels,
  use: (p: P) => Effect.Effect<A, E>,
  accountId?: string,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* CloudflaredTunnel.Provider);
    }).pipe(
      Effect.provide(
        CloudflaredTunnelProvider().pipe(Layer.provideMerge(fakeProviderLayer(fake, accountId))),
      ),
    ),
  );

export const reconcile = (
  p: P,
  news: CloudflaredTunnelProps,
  output?: CloudflaredTunnelAttributes,
) => p.reconcile({ ...ids, ...extra, news, olds: undefined, output });

export const read = (p: P, olds: CloudflaredTunnelProps, output?: CloudflaredTunnelAttributes) =>
  handler('read', p.read)({ ...ids, olds, output });

export const diff = (
  p: P,
  news: CloudflaredTunnelProps,
  olds: CloudflaredTunnelProps,
  output: CloudflaredTunnelAttributes,
) =>
  handler(
    'diff',
    p.diff,
  )({ ...ids, news, olds, newBindings: [] as never, oldBindings: [] as never, output });

/** A stored attribute set for a tunnel that may or may not exist in the fake. */
export const stored = (
  accountId: string,
  over: Partial<CloudflaredTunnelAttributes> = {},
): CloudflaredTunnelAttributes => ({
  id: 'x',
  accountId,
  name: 'k8s-admin',
  ...over,
});

/** Requests the fake saw for any `/token` path. The provider must never make one. */
export const tokenReads = (fake: FakeTunnels) =>
  fake.seen.filter((s) => s.path.includes('/token')).length;

/** The writes the fake saw, in order: `['POST', 'DELETE', …]`. */
export const writes = (fake: FakeTunnels) =>
  fake.seen.filter((s) => s.method !== 'GET').map((s) => s.method);

type Rows = Record<string, Record<string, Record<string, State.ResourceState>>>;

/**
 * ★ THE REAL ENGINE, NOT A MODEL OF IT: Alchemy's own `Plan.make` + `apply` over an in-memory
 *   state store (the same construction as mesh-node-harness.ts, which says why
 *   `FetchHttpClient.Fetch` is provided around the whole deploy). `rows` is the store itself, so a
 *   test can serialize exactly what Alchemy would persist.
 */
export const engine = (fake: FakeTunnels) => {
  const rows: Rows = {};
  const state = Layer.succeed(State.State, State.InMemoryService(rows));
  const providers = CloudflaredTunnelProvider().pipe(Layer.provide(fakeProviderLayer(fake)));
  const deploy = <A, E, R>(declare: Effect.Effect<A, E, R>) =>
    Effect.runPromiseExit(
      declare.pipe(
        makeStack({ name: 'tunnel', providers, state }) as never,
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
    rows,
    /** The stored row's status (`created`, `replacing`, …), or `undefined` when there is none. */
    status: (fqn: string) => rows['tunnel']?.['test']?.[fqn]?.status,
  };
};

/** The failure sentence of a deploy, or `''` when it succeeded. */
export const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '';
