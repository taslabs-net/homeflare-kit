/**
 * Prove a deploy's adoptions are no-ops — with Alchemy's own planner, before anything is written.
 *
 * ★ THE ENGINE PLANS, THIS ONLY WATCHES. `verifySession` runs `Plan.make` — the same call
 *   `alchemy plan` makes (Alchemist routes/stack.ts) — over the session's context with every
 *   provider swapped for a watched copy (spy.ts). Output resolution, the state lookup, rename
 *   migrations, the adoption probe and `adopt(…)` all stay the engine's; nothing here re-derives
 *   them. What it adds is the provider's own `diff` answer, which Plan.ts overwrites for every
 *   adopted row (`forceUpdateAfterAdoption`), and the state-row check that says which rows ARE
 *   adoptions.
 *
 * ⛔ READ-ONLY BY CONSTRUCTION. The planner calls `read` and `diff`; spy.ts replaces `reconcile`,
 *   `delete` and `precreate` with refusals; nothing here calls `apply`. `--all` adds one `read` per
 *   row with state — still a read by Alchemy's provider contract.
 * ⚠️ READS ARE NOT FREE FOR EVERY FAMILY. A kit PVE/PBS read mints a lease through OpenBao, which
 *   creates a short-lived API token on the cluster, exactly as `alchemy plan` does.
 */
import * as Alchemist from 'alchemy/Alchemist';
import {
  ArtifactStore,
  Artifacts,
  createArtifactStore,
  makeScopedArtifacts,
} from 'alchemy/Artifacts';
import { InstanceId } from 'alchemy/InstanceId';
import * as Plan from 'alchemy/Plan';
import type { ProviderService } from 'alchemy/Provider';
import type { CompiledStack } from 'alchemy/Stack';
import { State, isActionState } from 'alchemy/State';
import type * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { type AdoptRow, type PlanView, rowsOf } from './rows.ts';
import { type Observations, spyContext } from './spy.ts';

export interface VerifyOptions {
  /** Report every declared row and every pending deletion, not only rows without state. */
  readonly all?: boolean;
}

export interface AdoptReport {
  readonly stack: string;
  readonly stage: string;
  /** Resources the stack declares. */
  readonly declared: number;
  readonly rows: readonly AdoptRow[];
}

/** An imported stack and the context it plans under — what `Alchemist.open` returns. */
export interface VerifySession {
  readonly stack: CompiledStack<unknown, unknown>;
  readonly context: Context.Context<unknown>;
}

/** The plan-node fields `--all` needs to read a row that has state. */
type StatefulNode = {
  readonly provider?: ProviderService;
  readonly resource: { readonly LogicalId: string };
  readonly state?: {
    readonly instanceId: string;
    readonly props: object;
    readonly attr: object | undefined;
  };
};

/**
 * ⚠️ THE SAME SCOPE Plan.ts GIVES ITS OWN READS (`providePlanScope`, not exported): a scoped
 *   `Artifacts` bag and the row's `InstanceId`. A kit family that consults either — the ownership
 *   helpers do — sees what it would see under `alchemy plan`.
 */
const readWithState = (fqn: string, node: StatefulNode) =>
  Effect.gen(function* () {
    const read = node.provider?.read;
    if (read === undefined || node.state === undefined) return;
    const store = Option.getOrElse(yield* Effect.serviceOption(ArtifactStore), createArtifactStore);
    yield* read({
      fqn,
      id: node.resource.LogicalId,
      instanceId: node.state.instanceId,
      olds: node.state.props,
      output: node.state.attr,
    }).pipe(
      Effect.provideService(Artifacts, makeScopedArtifacts(store, fqn)),
      Effect.provideService(InstanceId, node.state.instanceId),
    );
  });

/** Which of `fqns` the stage's state store holds a resource row for. */
const withState = (stack: CompiledStack<unknown, unknown>, fqns: readonly string[]) =>
  Effect.gen(function* () {
    const store = yield* yield* State;
    const found = yield* Effect.all(
      fqns.map((fqn) =>
        store
          .get({ fqn, stack: stack.name, stage: stack.stage })
          .pipe(Effect.map((row) => (row === undefined || isActionState(row) ? [] : [fqn]))),
      ),
      { concurrency: 8 },
    );
    return new Set(found.flat());
  });

/**
 * Plan `session.stack` with watched providers and report each row without state (or, with
 * `all`, every row). Never writes.
 */
export const verifySession = (
  session: VerifySession,
  options: VerifyOptions = {},
): Effect.Effect<AdoptReport, unknown> => {
  const seen: Observations = new Map();
  const all = options.all === true;
  // ⚠️ THE CAST IS AT THE ENGINE'S TYPED BOUNDARY. `Plan.make` declares only `State` and hides the
  //   rest behind a ts-expect-error; the session context carries all of it, as in routes/stack.ts.
  const plan = Plan.make(session.stack) as unknown as Effect.Effect<
    PlanView & { readonly resources: Readonly<Record<string, StatefulNode>> },
    unknown
  >;
  return Effect.gen(function* () {
    const planned = yield* plan;
    const stateRows = yield* withState(session.stack, Object.keys(planned.resources));
    if (all) {
      const stateful = Object.entries(planned.resources).filter(([fqn]) => stateRows.has(fqn));
      yield* Effect.all(
        stateful.map(([fqn, node]) =>
          readWithState(fqn, node).pipe(
            Effect.catchCause(() =>
              Effect.sync(() => {
                const entry = seen.get(fqn) ?? {};
                entry.read = { answer: 'failed', attributes: undefined };
                seen.set(fqn, entry);
              }),
            ),
          ),
        ),
        { concurrency: 8 },
      );
    }
    return {
      declared: Object.keys(planned.resources).length,
      rows: rowsOf(planned, stateRows, seen, all),
      stack: session.stack.name,
      stage: session.stack.stage,
    } satisfies AdoptReport;
  }).pipe(Effect.provide(spyContext(session.context, seen)), Effect.scoped);
};

/** Where the stack lives — the fields `alchemy plan` takes as flags. */
export interface VerifyTarget {
  /** The stack entrypoint, e.g. `alchemy.run.ts`. */
  readonly entrypoint: string;
  readonly stage: string;
  readonly profile?: string;
  readonly envFile?: string;
}

/**
 * Import the stack the way the Alchemy CLI does and verify it.
 *
 * ★ `adopt: true`, ALWAYS, AND IT CANNOT WRITE. Planning is side-effect free (Plan.ts keeps the
 *   adopted state in memory, alchemy#793), so the flag only lets an `Unowned` row reach its
 *   `diff` instead of failing the plan — the report marks it, because the real deploy then needs
 *   `--adopt`. A resource declared `.pipe(adopt(false))` still fails the plan, as it would deploy.
 */
export const verifyStack = (
  target: VerifyTarget,
  options: VerifyOptions = {},
): Effect.Effect<AdoptReport, unknown> =>
  Effect.gen(function* () {
    const session = yield* Alchemist.open(target, { adopt: true });
    return yield* verifySession(session, options);
  }).pipe(Effect.scoped, Effect.provide(Alchemist.layer()));
