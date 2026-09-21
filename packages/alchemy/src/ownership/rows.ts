/**
 * The two questions ownership/ asks of Alchemy's state store: does a row record this instance
 * (probe.ts), and — when reconcile refuses a create — forget the row Apply committed for it
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

/** Every instance id a persisted row carries: its own, then each older generation's (`old`). */
const generationIds = (row: unknown): string[] => {
  const ids: string[] = [];
  let at = row;
  while (typeof at === 'object' && at !== null && !isActionState(at as never)) {
    const { instanceId, old } = at as { instanceId?: unknown; old?: unknown };
    if (typeof instanceId === 'string') ids.push(instanceId);
    at = old;
  }
  return ids;
};

/**
 * Whether the state store records `instanceId` for this resource — at its FQN, or at a former FQN
 * its `renamedFrom` names (the planner migrates that row before it recovers it).
 * ★ This is what separates the probe from the recovery read: the probe's instance id is minted for
 *   the probe (Plan.ts `generateInstanceId()`), 128 random bits no row can hold.
 */
export const recordedInstance = (fqn: string, instanceId: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const found = yield* storeOf;
    if (found === undefined) return false;
    for (const at of [fqn, ...(found.resources[fqn]?.FormerFqns ?? [])]) {
      const row = yield* rowAt(found.store, found.where, at);
      if (generationIds(row).includes(instanceId)) return true;
    }
    return false;
  });

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
