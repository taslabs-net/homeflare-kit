/**
 * Alchemy's own Plan and Apply, run in-process over an in-memory state store, so a test can deploy a
 * declaration, change it, deploy again, and see what the ENGINE did with a provider's answers: which
 * action it planned, and which calls reached the fake.
 *
 * ★ WHY THE ENGINE AND NOT THE HANDLERS ALONE. A diff that answers `replace` proves nothing by itself.
 *   What matters is that Apply then creates the new generation, deletes the OLD one with the OLD
 *   attributes, and keeps it under `retain`. Those are claims about alchemy@2.0.0-beta.79, and this
 *   harness measures them instead of restating them (REPLACE.md).
 * ★ NOT alchemy/Test/Bun. Its runtime builds the CLI's profile and credentials stores, which read
 *   files under the home directory, plus a file logger. This needs none of that: the providers, an
 *   in-memory state store, a stage, and the stack's own services. It is the composition
 *   alchemy/src/Deploy.ts uses, minus the platform layer.
 *
 * ⛔ TEST-ONLY, AND NEVER A REAL VAULT. `BaoEnv` is provided explicitly, so a BAO_ADDR or BAO_TOKEN
 *   in the shell running the tests is never read. No provider imports this file.
 */
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { BaoEnvironment } from './bao-address.ts';
import { BaoEnv } from './bao-http.ts';
import { type Fake, type Reply, type Seen, fakeBao } from './fake-bao.ts';

/** The planned action for each resource, deletions included, keyed by FQN. */
export type Planned = Readonly<Record<string, string>>;

/** A stack body: resource declarations, as an `alchemy.run.ts` would write them. */
export type StackBody = Effect.Effect<unknown, unknown, unknown>;

export interface FakeStack {
  /** Plan, then apply, `body`. Resolves to the plan; rejects with the apply's failure. */
  readonly deploy: (body: StackBody) => Promise<Planned>;
}

type Node = { readonly action: string };
type PlanView = {
  readonly resources: Readonly<Record<string, Node>>;
  readonly deletions: Readonly<Record<string, Node | undefined>>;
};

const actionsOf = (plan: PlanView): Planned => {
  const out: Record<string, string> = {};
  for (const [fqn, node] of Object.entries(plan.resources)) out[fqn] = node.action;
  for (const [fqn, node] of Object.entries(plan.deletions)) {
    if (node !== undefined) out[fqn] = node.action;
  }
  return out;
};

/**
 * One stack over one state store, shared by every `deploy`, so the second deploy plans against what
 * the first one recorded.
 *
 * ⚠️ THE CASTS ARE AT THE ENGINE'S TYPED BOUNDARY, NOT IN THE PROVIDERS. `Alchemy.Stack` types its body
 *   against every service a CLI run provides. Here the body needs only the providers given, and a
 *   missing one fails the test by name ("Provider not found for …").
 */
export const fakeStack = <ROut, E, RIn>(
  providers: Layer.Layer<ROut, E, RIn>,
  env: BaoEnvironment,
  name = 'RenameStack',
): FakeStack => {
  const state = Alchemy.inMemoryState();
  const stack = Alchemy.Stack as unknown as (
    stackName: string,
    options: { providers: typeof providers; state: typeof state },
    body: StackBody,
  ) => Effect.Effect<{ readonly services: never }, unknown, never>;
  const plan = Alchemy.Plan.make as unknown as (
    compiled: unknown,
  ) => Effect.Effect<PlanView, unknown, never>;
  const apply = Alchemy.apply as unknown as (planned: PlanView) => Effect.Effect<unknown, unknown>;

  const deploy = (body: StackBody) =>
    Effect.gen(function* () {
      const compiled = yield* stack(name, { providers, state }, body);
      return yield* Effect.gen(function* () {
        const planned = yield* plan(compiled);
        yield* apply(planned);
        return actionsOf(planned);
      }).pipe(Effect.provide(Layer.succeedContext(compiled.services)));
    }).pipe(
      Effect.provideService(Alchemy.Stage, 'test'),
      Effect.provideService(BaoEnv, env),
      Effect.provide(state),
      Effect.scoped,
    );

  return { deploy: (body) => Effect.runPromise(deploy(body) as Effect.Effect<Planned>) };
};

/**
 * A fake engine answering with `answer`, and one stack over it, for one test. The fake stops however
 * `body` ends.
 */
export const withFakeStack = async <ROut, E, RIn>(
  providers: Layer.Layer<ROut, E, RIn>,
  answer: (seen: Seen) => Reply,
  body: (stack: FakeStack, bao: Fake) => Promise<void>,
): Promise<void> => {
  const bao = fakeBao(answer);
  try {
    await body(fakeStack(providers, { BAO_ADDR: bao.address }), bao);
  } finally {
    bao.stop();
  }
};

/** Every call that changed something, as `METHOD /v1/path`, in order. */
export const writesOf = (seen: readonly Seen[]): string[] =>
  seen.filter((each) => each.method !== 'GET').map((each) => `${each.method} ${each.path}`);
