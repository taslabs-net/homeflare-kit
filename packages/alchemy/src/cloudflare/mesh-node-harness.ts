/**
 * MeshNodeProvider's handlers, called the way the engine calls them, over the fake Cloudflare in
 * fake-mesh.ts. Shared by mesh-node.test.ts and mesh-node-edges.test.ts.
 *
 * ⛔ TEST-ONLY, like fake-mesh.ts: no provider imports this file and it is not on the barrel.
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
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
