/**
 * Alchemy's own `Plan.make`/`apply`, run in-process over an in-memory state store, for
 * `declare-repo-baseline-apply-order.test.ts` and `repo-policy-apply-order.test.ts`.
 *
 * ★ SAME SHAPE AS `litellm/fake-stack.ts` AND `openbao/fake-stack.ts` — copied, not
 *   reinvented: those two files' own headers explain why the ENGINE has to run (a `diff`/`props`
 *   answer proves nothing about what Apply actually schedules) rather than calling provider
 *   handlers directly, which is exactly what this PR needs to prove about apply ORDER. The casts
 *   below sit at the same typed boundary theirs do — `Alchemy.Stack` types its body against
 *   every service a CLI run provides; this harness's body only ever needs the providers given.
 */
import * as Alchemy from 'alchemy';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { provideFreshArtifactStore } from 'alchemy/Artifacts';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

export type Planned = Readonly<Record<string, string>>;
export type StackBody = Effect.Effect<unknown, unknown, unknown>;
export type DeployOptions = { readonly adopt?: boolean };

export interface FakeStack {
  /** Plan, then apply, `body`. Resolves to the plan; rejects with the apply's failure. */
  readonly deploy: (body: StackBody, options?: DeployOptions) => Promise<Planned>;
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

export const fakeStack = <ROut, E, RIn>(
  providers: Layer.Layer<ROut, E, RIn>,
  name = 'RepoApplyOrderStack',
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

  const deploy = (body: StackBody, options: DeployOptions = {}) =>
    Effect.gen(function* () {
      const compiled = yield* stack(name, { providers, state }, body);
      return yield* Effect.gen(function* () {
        const planned = yield* plan(compiled);
        yield* apply(planned);
        return actionsOf(planned);
      }).pipe(provideFreshArtifactStore, Effect.provide(Layer.succeedContext(compiled.services)));
    }).pipe(
      options.adopt === undefined ? (e) => e : Effect.provideService(AdoptPolicy, options.adopt),
      Effect.provideService(Alchemy.Stage, 'test'),
      Effect.scoped,
    );

  return {
    deploy: (body, options) => Effect.runPromise(deploy(body, options) as Effect.Effect<Planned>),
  };
};
