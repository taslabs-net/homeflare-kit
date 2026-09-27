/**
 * Alchemy's own Plan and Apply, run in-process over an in-memory state store, so a test can deploy a
 * `LiteLLM.PassThroughEndpoint` declaration, change it, deploy again, and see what the ENGINE did
 * with the provider's answers: which action it planned, and which calls reached the fake proxy.
 *
 * ★ WHY THE ENGINE AND NOT THE HANDLERS ALONE (openbao/fake-stack.ts's own reasoning, copied here
 *   because a `diff` answer proves nothing by itself). `Apply.ts` mints a FRESH `instanceId` for a
 *   create-first `replace` and calls `reconcile` with `output: undefined, olds: undefined` — a call
 *   shape `pass-through-endpoint.test.ts`'s handler-only tests never produce (see the file's own
 *   test that reuses the OLD instanceId and output, which is why it passed while the engine path
 *   was broken). This harness drives the real `Plan.make`/`apply` instead of restating the claim.
 * ★ NOT alchemy/Test/Bun — same reasoning as openbao/fake-stack.ts: no CLI profile/credentials
 *   files, no file logger. Just the provider, an in-memory state store, and the stack's services.
 */
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Alchemy from 'alchemy';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { provideFreshArtifactStore } from 'alchemy/Artifacts';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { litellmProviders } from './providers.ts';

/** The planned action for each resource, deletions included, keyed by FQN. */
export type Planned = Readonly<Record<string, string>>;

/** A stack body: resource declarations, as an `alchemy.run.ts` would write them. */
export type StackBody = Effect.Effect<unknown, unknown, unknown>;

/** What the CLI would set for one deploy: `adopt` is `--adopt` (the AdoptPolicy service). */
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

/**
 * ⚠️ CREDENTIALS COME FROM `litellmProviders`, NOT AN OUTER `Effect.provide`. The handlers read
 *   `Credentials` when Apply calls them, not when the provider value is built. `provideMerge`
 *   keeps that service in the layer output, so it is in `compiled.services` — the context this
 *   harness gives Apply. An outer `Effect.provide(credentials)` would hide a sealed `Layer.provide`:
 *   the handlers would still see the key, and this harness would not catch the regression.
 * ⚠️ `HttpClient` STAYS AMBIENT, wrapped around the pipeline below. `litellmProviders` does not
 *   bundle one; Alchemy's runtime provides it the same way. Do not add a second client here.
 * ★ `fetchFn` IS `startFakeLitellm(...).fetch` (fake-litellm.ts) — this harness never opens a real
 *   socket; `FetchHttpClient.Fetch` is the seam the SDK's protocol layer calls through, same as
 *   `../netbox/fake-netbox.ts`'s `fakeNetboxLayer`.
 */
export const fakeStack = (
  creds: { readonly apiKey: string; readonly baseUrl: string },
  fetchFn: typeof globalThis.fetch,
  name = 'PassThroughStack',
): FakeStack => {
  const state = Alchemy.inMemoryState();
  const providers = litellmProviders(credentials(creds));
  // ⚠️ THE CAST STAYS. `StackBody` is `Effect<unknown, unknown, unknown>` so a test can pass any
  //   declaration, and that channel is not a legal `Alchemy.Stack` body. The uncast construction
  //   is pass-through-stack.test.ts. This cast used to also hide `Credentials` leaking out of the
  //   resource type; that leak is gone, and this harness still has to deploy.
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
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.scoped,
    );

  return {
    deploy: (body, options) => Effect.runPromise(deploy(body, options) as Effect.Effect<Planned>),
  };
};

/** Every call that changed something, as `METHOD path`, in order. */
export const writesOf = (
  requests: readonly { readonly method: string; readonly path: string }[],
): string[] =>
  requests.filter((each) => each.method !== 'GET').map((each) => `${each.method} ${each.path}`);
