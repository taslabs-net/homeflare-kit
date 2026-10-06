/**
 * A FRESH `Talos.ClusterHealth` skips `diff` while its inputs are unresolved, so the literal-uid
 * refusal must already have happened when the resource is DECLARED. Driven through a real
 * `Alchemy.Stack` (the engine's own declaration path, no handler called directly): an Output uid
 * fails the stack before any plan exists, and a literal one still declares.
 */
import { expect, test } from 'bun:test';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';
import { talosOpenBaoConnection } from './cluster-adapter.ts';
import { TalosClusterHealth, TalosClusterHealthProvider } from './talos-cluster-health.ts';
import './fake-process.ts';

const base = { controlPlaneNodes: ['198.51.100.10'], target: { cluster: 'c1', mount: 'talos-c1' } };

const compile = (body: unknown) => {
  const stack = Alchemy.Stack as unknown as (
    name: string,
    options: { providers: unknown; state: unknown },
    body: unknown,
  ) => Effect.Effect<unknown, unknown, never>;
  return stack(
    'talos-health-declare',
    { providers: TalosClusterHealthProvider(), state: Alchemy.inMemoryState() },
    body,
  ).pipe(Effect.provideService(Alchemy.Stage, 'test'), Effect.scoped);
};

test('declaring a fresh health resource whose uid is an Output fails the stack', async () => {
  const failure = await Effect.runPromise(
    compile(
      Effect.gen(function* () {
        const first = yield* TalosClusterHealth('First', {
          ...base,
          connection: talosOpenBaoConnection('uid-c1'),
        });
        // A real Output: an attribute of another resource, unresolved until it deploys.
        const uid = (first as unknown as { controlPlaneNodes: unknown }).controlPlaneNodes;
        yield* TalosClusterHealth('Second', {
          ...base,
          connection: { auth: { kind: 'talos-openbao', uid } },
        } as never);
      }),
    ).pipe(Effect.flip),
  );
  expect((failure as { _tag: string })._tag).toBe('TalosUidNotLiteral');
});

test('a literal uid declares fine', async () => {
  const compiled = await Effect.runPromise(
    compile(TalosClusterHealth('Only', { ...base, connection: talosOpenBaoConnection('uid-c1') })),
  );
  expect(compiled).toBeDefined();
});
