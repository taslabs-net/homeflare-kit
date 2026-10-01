/**
 * The questions ownership/ asks of Alchemy's state store: does a row record this instance, and with
 * its whole declaration (probe.ts); is this apply a create rather than a replace's new generation
 * (adopt.ts); and — when reconcile refuses a create — forget the row Apply committed for it
 * (adopt.ts). Alchemy's own AWS.EC2.SecurityGroup provider reads the store the same way: the Stack
 * service names the stack and stage, and `State` yields the store.
 *
 * ⚠️ WITHOUT A STACK OR STATE IN CONTEXT, or with a store that errors, a row reads as "not
 *   recorded" — the object is then `Unowned`, the safe answer — and nothing is forgotten, which
 *   leaves the one gap forgetRefusedCreate exists to close. `alchemy deploy` and the Alchemist
 *   session provide both.
 */
import { Stack } from 'alchemy/Stack';
import { State, type StateService, isActionState } from 'alchemy/State/State';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { wholeDeclaration } from './whole.ts';

type Where = { readonly stack: string; readonly stage: string };

/** The store, where this stack lives, and what it declares — or undefined outside a stack. */
const storeOf = Effect.gen(function* () {
  const stack = yield* Effect.serviceOption(Stack);
  const state = yield* Effect.serviceOption(State);
  if (Option.isNone(stack) || Option.isNone(state)) return undefined;
  const store: StateService = yield* state.value;
  const where: Where = { stack: stack.value.name, stage: stack.value.stage };
  return { resources: stack.value.resources, store, where };
});

const rowAt = (store: StateService, where: Where, fqn: string) =>
  store.get({ ...where, fqn }).pipe(Effect.orElseSucceed(() => undefined));

/** One generation of a persisted row, as far as ownership/ reads it. */
export type Generation = {
  readonly instanceId?: unknown;
  readonly status?: unknown;
  readonly props?: unknown;
  readonly attr?: unknown;
  readonly old?: unknown;
  /** Set by Apply on the `updating` row of an adoption, until that update commits (Apply.ts). */
  readonly adopting?: unknown;
};

/** The generation of a persisted row that carries `instanceId`: the row itself, or one in `old`. */
const generationOf = (row: unknown, instanceId: string): Generation | undefined => {
  let at = row;
  while (typeof at === 'object' && at !== null && !isActionState(at as never)) {
    const generation = at as Generation;
    if (generation.instanceId === instanceId) return generation;
    at = generation.old;
  }
  return undefined;
};

/** The generation `instanceId` names — at the FQN, or at a former FQN `renamedFrom` names. */
export const recordedGeneration = (
  fqn: string,
  instanceId: string,
): Effect.Effect<Generation | undefined> =>
  Effect.gen(function* () {
    const found = yield* storeOf;
    if (found === undefined) return undefined;
    for (const at of [fqn, ...(found.resources[fqn]?.FormerFqns ?? [])]) {
      const generation = generationOf(yield* rowAt(found.store, found.where, at), instanceId);
      if (generation !== undefined) return generation;
    }
    return undefined;
  });

/**
 * What the state store says of `instanceId` for this resource (at its FQN, or at a former FQN its
 * `renamedFrom` names — the planner migrates that row before it recovers it):
 *   · `absent`  — no row holds it. ★ This is what separates the probe from the recovery read: the
 *     probe's instance id is minted for the probe (Plan.ts `generateInstanceId()`), 128 random bits
 *     no row can hold.
 *   · `partial` — a row holds it, but its props lack part of the declaration: a prop stripped at
 *     commit because it was still an Output (whole.ts). Those props cannot prove an object ours.
 *   · `whole`   — a row holds it with every prop the declaration names.
 */
export type Recorded = 'absent' | 'partial' | 'whole';

export const recordedInstance = (fqn: string, instanceId: string): Effect.Effect<Recorded> =>
  Effect.gen(function* () {
    const generation = yield* recordedGeneration(fqn, instanceId);
    if (generation === undefined) return 'absent';
    return (yield* wholeDeclaration(fqn, generation.props)) ? 'whole' : 'partial';
  });

/**
 * Whether this apply's `instanceId` is a CREATE: the row Apply committed for it is `creating`.
 * ⛔ A REPLACE'S NEW GENERATION IS NOT ONE. Apply commits it as `replacing`, and the planner never
 *   offers it adoption — the probe runs only for a resource with no state — so `--adopt` must not
 *   let it write over whatever sits at its new identity (adopt.ts adoptsAtApply).
 */
export const isCreate = (fqn: string, instanceId: string): Effect.Effect<boolean> =>
  Effect.map(
    recordedGeneration(fqn, instanceId),
    (generation) => generation?.status === 'creating',
  );

const idOf = (attr: unknown): string | undefined => {
  if (typeof attr !== 'object' || attr === null) return undefined;
  const id = (attr as { readonly id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
};

/**
 * `attr.id` on every generation OLDER than `instanceId` in this FQN's state chain (and a former
 * FQN `renamedFrom` names). Walks `old` the way {@link generationOf} does, and skips the current
 * generation itself.
 * ⛔ THOSE IDS ARE NOT THIS GENERATION'S. A `replacing` row's reconcile runs with no attributes, so
 *   a live row found by name can be the previous generation's own deployment. Recording that id on
 *   the new generation makes both the same id, and `destroy()` then deletes the old generation by
 *   it (Apply.ts, the retain check near 2168 and the provider delete that follows when the policy
 *   is not `retain`). A same-instance `old` snapshot (an `updating` row) is not one of these.
 */
export const olderGenerationIds = (
  fqn: string,
  instanceId: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const found = yield* storeOf;
    if (found === undefined) return [];
    const ids: string[] = [];
    for (const at of [fqn, ...(found.resources[fqn]?.FormerFqns ?? [])]) {
      collectOlder(yield* rowAt(found.store, found.where, at), instanceId, ids);
    }
    return ids;
  });

/**
 * Once `instanceId` has been seen, collect `attr.id` from generations with a DIFFERENT instance
 * id. An `updating` row's `old` is the same instance's pre-update snapshot (Apply.ts), not a
 * replacement generation — that snapshot's id is the row this apply is already writing.
 */
const collectOlder = (row: unknown, instanceId: string, ids: string[]): void => {
  let at = row;
  let seen = false;
  while (typeof at === 'object' && at !== null && !isActionState(at as never)) {
    const generation = at as Generation;
    if (!seen) {
      seen = generation.instanceId === instanceId;
      at = generation.old;
      continue;
    }
    if (generation.instanceId !== instanceId) {
      const id = idOf(generation.attr);
      if (id !== undefined) ids.push(id);
    }
    at = generation.old;
  }
};

/**
 * ⛔ A REFUSED CREATE MUST NOT LEAVE A ROW THAT CLAIMS THE OBJECT IT REFUSED. Apply commits a
 *   `creating` row for this instance before it calls reconcile, and a failed reconcile leaves it
 *   there. The next plan's recovery read would then find our instance id and an object that can
 *   match its props — a prop that was an Output is stripped from the row, and an omitted prop is
 *   "not managed" — and adopt exactly what this apply refused. 🔴 MEASURED 2026-09-21: Bao.Mount
 *   and Bao.AuthMethod did (openbao/adopt-core.test.ts). So the row goes, and state reads as if
 *   the create never started: the next plan probes, and the probe answers `Unowned`.
 * ⚠️ ONLY a `creating` row of THIS instance with no attributes — the one Apply just wrote. A
 *   `replacing` row carries the previous generation in `old` and is never touched.
 */
export const forgetRefusedCreate = (fqn: string, instanceId: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const found = yield* storeOf;
    if (found === undefined) return;
    const row = yield* rowAt(found.store, found.where, fqn);
    const mine = row as { status?: unknown; instanceId?: unknown; attr?: unknown } | undefined;
    if (mine?.status !== 'creating' || mine.instanceId !== instanceId || mine.attr !== undefined) {
      return;
    }
    yield* found.store.delete({ ...found.where, fqn }).pipe(Effect.ignore);
  });
