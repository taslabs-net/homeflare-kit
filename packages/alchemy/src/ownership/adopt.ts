/**
 * Whether a live object this stack holds no state for may be written — the apply-time half of the
 * house rule that NOTHING IS ADOPTED WITHOUT `--adopt` (decided 2026-09-21 for HostFile, LaunchdJob,
 * CaddyConfig and every Bao.* family). probe.ts is the plan-time half.
 *
 * ★ FAMILY-NEUTRAL ON PURPOSE. The engine questions here — what `--adopt` resolves to for one FQN,
 *   whether this apply resumes the resource's own interrupted create — are the same for a vault
 *   role, a launchd plist and a Caddy config, so they live once, outside every subpath's directory.
 */
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { resumes, unfinished } from './resume.ts';
import { forgetRefusedCreate, isCreate } from './rows.ts';

/**
 * Whether the resource at `fqn` may be adopted, resolved exactly as the planner resolves it (alchemy
 * beta.79 Plan.ts: `resource.Adopt ?? shouldAdopt`): a resource-scoped `adopt(…)`, else the
 * `AdoptPolicy` service, else `AlchemyContext.adopt`, else off.
 * ★ FOR A CREATE THE ENGINE NEVER PROBED. Alchemy skips the adoption probe while `news` holds an
 *   Output, so an ownership check that must still honour `--adopt` can only run at apply. All three
 *   reach the apply: Alchemist runs plan AND apply under the session context, which provides the
 *   services from the CLI flag and the Stack the resources registered on (Alchemist/Session.ts,
 *   routes/stack.ts; Apply.ts reads the same Stack).
 * ⛔ THE RESOURCE-SCOPED SETTING WINS, BOTH WAYS. The engine captures `adopt(…)` on the resource at
 *   registration (Resource.ts `Adopt`, into `Stack.resources[fqn]`) and never hands it to a
 *   provider. Reading only the deploy-wide flag let `--adopt` take over a resource declared
 *   `.pipe(adopt(false))` — which the planner refuses — and refused one declared `adopt(true)`.
 * ⚠️ `resources` carries an `@internal` comment in Alchemy's source, but it is in the published types
 *   and the planner reads `Adopt` from it. caddy/adopt-scope.test.ts registers through the real
 *   `Resource`, so an upgrade that stops recording it there fails the suite.
 */
export const adoptEnabled = (fqn: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const stack = yield* Effect.serviceOption(Stack);
    const scoped = Option.isSome(stack) ? stack.value.resources[fqn]?.Adopt : undefined;
    if (scoped !== undefined) return scoped;
    const policy = yield* Effect.serviceOption(AdoptPolicy);
    if (Option.isSome(policy)) return policy.value;
    const context = yield* Effect.serviceOption(AlchemyContext);
    return Option.isSome(context) ? context.value.adopt : false;
  });

/** The three fields of a `reconcile` (or `read`) call that say whose object this is. */
export type Owner = {
  readonly fqn: string;
  readonly instanceId: string;
  /** The attributes state holds; `undefined` on a create. */
  readonly output: unknown;
};

/**
 * Whether `--adopt` may speak for this apply's generation: a CREATE (rows.ts isCreate), or an
 * UNFINISHED generation whose row this plan's diff saw with no attributes (resume.ts) — the
 * resume Alchemy itself offers `--adopt` for ("Cannot resume creating … Re-run with --adopt").
 * ⛔ NOT A FRESH REPLACE'S NEW GENERATION. The planner never probes it and never offers it adoption,
 *   so the identity it moves to was never asked about under `--adopt`: 🔴 MEASURED 2026-09-21
 *   (launchd/adopt-apply.test.ts), a HostFile whose path changed onto a file it did not own
 *   overwrote that file under a deploy-wide `--adopt` meant for something else. A Bao rename onto a
 *   taken identity already fails the plan, `--adopt` or not (rename.ts judgeMove); this keeps the
 *   apply to the same answer.
 */
const adoptable = (owner: Owner): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (yield* isCreate(owner.fqn, owner.instanceId)) return true;
    return yield* unfinished(owner.instanceId);
  });

/** Whether a stateless `reconcile` may take over a live object: adoption on, for an adoptable one. */
export const adoptsAtApply = (owner: Owner): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (!(yield* adoptEnabled(owner.fqn))) return false;
    return yield* adoptable(owner);
  });

/** A lifecycle helper's hook for refuseTakeover, bound to one call's Owner: `(what) => …`. */
export type Claim = (what: string) => Effect.Effect<void>;

/**
 * `reconcile`'s check, called with the live object it found BEFORE any write: dies unless that
 * object may be written. It may when state already vouches for it (`output`), when this apply
 * resumes the resource's own interrupted create or replace and its diff proved the object that
 * generation's (resume.ts), or when adoption is on for a create or an unfinished generation
 * (adoptable).
 * ⛔ WHY IT EXISTS AT ALL: THE PROBE DOES NOT GUARD EVERY CREATE. Alchemy skips it while `news` holds
 *   an Output (Plan.ts), a new generation of a replace is never probed, and an object can appear
 *   between plan and apply. Each of those used to be a silent takeover: written over, then recorded
 *   as ours, and deleted with the stack under `destroy`.
 * ⚠️ A CHECK, THEN A WRITE — NOT A LOCK. Two creates of one name in the same deploy run
 *   concurrently, both read nothing, and both write (measured with the fakes, 2026-09-21). Nothing
 *   between a read and a write can close that; declare each name once.
 * ⚠️ AN IDENTICAL OBJECT IS STILL A TAKEOVER (decided 2026-09-21). Nothing would be written, but the
 *   state row would claim it, and a later delete would remove what another owner still relies on.
 * ⛔ A REFUSED CREATE FORGETS ITS `creating` ROW (rows.ts forgetRefusedCreate), or the next plan's
 *   recovery read would adopt the very object this refused.
 */
export const refuseTakeover = (owner: Owner, what: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (owner.output !== undefined) return;
    if (yield* resumes(owner.instanceId)) return;
    const may = yield* adoptable(owner);
    if (may && (yield* adoptEnabled(owner.fqn))) return;
    yield* forgetRefusedCreate(owner.fqn, owner.instanceId);
    const remedy = may
      ? 'Deploy with --adopt (or wrap the resource in adopt(true)) to take it over, or remove it first.'
      : 'It is the new identity of a replace, which --adopt does not cover: remove it first.';
    return yield* Effect.die(
      new Error(
        `${what}: already exists, and this stack holds no state for it — the plan could not ask ` +
          'first (a prop was still an Output, a replace moved onto it, or it appeared after the ' +
          `plan). Nothing was written. ${remedy}`,
      ),
    );
  });

/** refuseTakeover bound to one call's Owner, for a lifecycle helper that finds the live object. */
export const claimFor =
  (owner: Owner): Claim =>
  (what) =>
    refuseTakeover(owner, what);
