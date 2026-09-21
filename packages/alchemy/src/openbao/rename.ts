/**
 * Rename safety for the families whose identity is a name, a mount and a name, or a catalog key:
 * the primitives. rename-identity.ts builds each family's diff and reconcile step from them, and
 * REPLACE.md has the audit and what each answer does.
 *
 * ⛔ THE BUG THIS CLOSES, REPRODUCED 2026-09-21 AGAINST alchemy@2.0.0-beta.79's OWN PLAN AND APPLY
 *   (fake-stack.ts): a Bao.Policy deployed as `old`, then redeclared as `new` under
 *   `RemovalPolicy.destroy()`, planned `update` and left BOTH policies live. diff read the NEW
 *   path, found nothing, answered `update`, and reconcile wrote the new object. The old one stayed
 *   live under no state record, so no later plan would mention it, and not even `destroy` could
 *   remove it.
 * ★ A CHANGED IDENTITY IS A DIFFERENT OBJECT, SO THE ANSWER IS `replace`. Create-first
 *   (`deleteFirst` false): the new path never collides with the old, the new generation is written,
 *   dependents are updated in the same graph, and only then is the old generation deleted. The
 *   engine hands that delete the OLD generation's attributes (Apply.ts deleteOldGenerations and the
 *   GC pass both pass `output: old.attr`), and every delete here reads `output`, never `news`.
 *   ⛔ A new path that collides with ANOTHER live object is refused at plan instead (`judgeMove`).
 * ⚠️ UNDER `retain` THE OLD OBJECT STAYS LIVE. Apply.ts:2164-2173 skips the old generation's delete
 *   and logs "Retaining replaced resource (removal policy: retain)". The plan still says `replace`
 *   and the apply says what it kept, so it is no longer silent, but the old object is unmanaged
 *   from then on. Remove it by hand, or opt into `RemovalPolicy.destroy()`.
 */
import * as Effect from 'effect/Effect';
import { baoRead } from './bao-http.ts';

const exact = (identity: string): string => identity;

/**
 * A string prop of a diff's `news`, once that one prop is resolved; `undefined` while it is still an
 * Output of a changing upstream (a function-typed proxy) or an Effect.
 *
 * ★ THE IDENTITY IS JUDGED BEFORE `isResolved(news)`. That guard returns `undefined` when ANY prop is
 *   pending, and the engine then falls back to `update` (Plan.ts, `havePropsChanged`). A rename that
 *   lands in the same deploy as a pending `fragments` or `policies` Output would slip through as
 *   `update`, which is the orphan again. launchd/host-effect.ts reads its identity the same way.
 */
export const declaredString = (news: unknown, key: string): string | undefined => {
  if (typeof news !== 'object' || news === null) return undefined;
  const value: unknown = (news as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/** True while an optional prop is declared but is not yet a value: an Output of a changing upstream. */
export const isPendingProp = (news: unknown, key: string): boolean => {
  if (typeof news !== 'object' || news === null) return false;
  const value: unknown = (news as Record<string, unknown>)[key];
  return value !== undefined && typeof value !== 'string';
};

/**
 * An optional string prop: `fallback` when it is absent, undefined while it is still an Output.
 * ⚠️ Not `declaredString(…) ?? fallback`, which would read a pending mount as the default mount.
 */
export const declaredOr = (news: unknown, key: string, fallback: string): string | undefined =>
  isPendingProp(news, key) ? undefined : (declaredString(news, key) ?? fallback);

/**
 * A role's API path from a diff's `news`, once both `mount` and `name` are resolved. `defaultMount`
 * is what an absent `mount` means; without one, an absent mount is unknown.
 */
export const declaredRolePath = (
  news: unknown,
  rolePath: (mount: string, name: string) => string,
  defaultMount?: string,
): string | undefined => {
  const mount =
    defaultMount === undefined
      ? declaredString(news, 'mount')
      : declaredOr(news, 'mount', defaultMount);
  const name = declaredString(news, 'name');
  return mount === undefined || name === undefined ? undefined : rolePath(mount, name);
};

/**
 * How OpenBao keys an ACL policy: trimmed and lowercased. openbao v2.6.2
 * vault/policy/policy_store.go:698-700 (`sanitizeName`), applied by SetPolicy (:268), GetPolicy
 * (:378) and DeletePolicy (:562).
 *
 * ⛔ SO `Admin` → `admin` IS THE SAME POLICY, NOT A RENAME. A `replace` there would write it, and then,
 *   under `destroy`, delete the old generation, which is that same policy. Every grant it carries
 *   would be revoked by a change of case.
 */
export const policyKey = (name: string): string => name.trim().toLowerCase();

/**
 * Whether the declared identity names a different object than the one in state: `true` → moved (the
 * diff asks `judgeMove`, which also reads the target); `false` → the same object; `undefined` → not
 * knowable yet, because the declared side is still an Output. `key` is how the SERVER keys the object (`policyKey`); the default is exact,
 * which is right for a mount path (vault/routing/router.go folds no case) and for both plugins'
 * roles (each stores `roles/<name>` verbatim).
 *
 * ⛔ NEVER `replace` ON AN UNKNOWN IDENTITY. The Output may resolve to the same path, and a replace
 *   onto the same path deletes, under `destroy`, the object it has just written. The diff defers
 *   instead. If the engine then plans `update` and the identity turns out to have changed,
 *   `refuseMovedUpdate` stops reconcile before it writes anything.
 */
export const isMoved = (
  stored: string,
  declared: string | undefined,
  key: (identity: string) => string = exact,
): boolean | undefined => (declared === undefined ? undefined : key(stored) !== key(declared));

/**
 * The diff's first question, asked before `isResolved(news)`: the move from the identity this
 * resource last wrote or tried (`tried`) to the declared one, or undefined when both name the same
 * object or either is still unknown. `pathOf` is the API path an identity is read at.
 *
 * ⛔ A MOVE ONTO AN OBJECT THAT ALREADY EXISTS FAILS THE PLAN. MEASURED 2026-09-21 through the engine
 *   (rename-occupied.test.ts): two policies that swapped names under `RemovalPolicy.destroy()` each
 *   planned `replace`, each new generation wrote over the other's live policy, and each old
 *   generation's delete then removed the name the other had just written. The deploy was green and
 *   both policies were gone, every grant revoked. A shift (a → b while b → c), and a move onto the
 *   name of a resource leaving the stack, were measured ending the same way. So was reverting a
 *   move whose new generation failed: the old generation still holds the name, and its delete runs
 *   after the revert has rewritten it. That is why `tried` falls back to the props of an unfinished
 *   write.
 * ⚠️ THE DIFF CANNOT SEE THE REMOVAL POLICY, SO THIS REFUSES UNDER `retain` TOO, where a swap, or a
 *   move back onto a retained old generation, would have been harmless. The cost is a move in two
 *   deploys through a free name, or removing the target by hand. The alternative is a green deploy
 *   that deletes what it has just written.
 * ★ ONE PLAN-TIME READ, OF A PATH THE NEW GENERATION'S RECONCILE READS ANYWAY. A 404, a missing mount
 *   included, is free; a refused read fails the plan, as any other diff read does.
 */
export const judgeMove = (
  family: string,
  tried: string | undefined,
  declared: string | undefined,
  pathOf: (identity: string) => string,
  key: (identity: string) => string = exact,
) =>
  Effect.gen(function* () {
    if (tried === undefined || declared === undefined || key(tried) === key(declared)) {
      return undefined;
    }
    if ((yield* baoRead(pathOf(declared))) === undefined) return { from: tried, to: declared };
    return yield* Effect.die(
      new Error(
        `${family}: ${tried} → ${declared} would land on an object that already exists at ` +
          `${declared}. Under RemovalPolicy.destroy() a resource moving off that name (a swap, a ` +
          'shift, or a reverted move that did not finish) deletes it after this one writes it. ' +
          'Nothing was written. Move through a name nothing holds, in two deploys, or remove ' +
          `${declared} by hand first.`,
      ),
    );
  });

/**
 * Reconcile's guard: an `update` whose prior attributes name another object.
 *
 * ★ REACHED ONLY WHEN THE DIFF COULD NOT SEE THE NEW IDENTITY at plan time. A fresh create, and the
 *   new generation of a `replace`, both reach reconcile with `output` undefined (Apply.ts passes
 *   `output: attr`, which is empty for a new generation). An `update` reaches it with the previous
 *   generation's attributes.
 * ★ THE FAILED DEPLOY SETTLES ITSELF. Apply has already committed the row as `updating`, with the new
 *   props and the OLD attributes. By the next plan the upstream Output has landed, so the diff sees
 *   both names and answers `replace` (or refuses, if the new name is already taken: `judgeMove`).
 *   The old object is then deleted, or retained, by the removal policy, with no hand repair.
 */
export const refuseMovedUpdate = (family: string, from: string, to: string) =>
  Effect.die(
    new Error(
      `${family}: planned as an update, but its identity moved from ${from} to ${to}. Writing ` +
        `${to} now would leave ${from} live with no state record. Nothing was written. Run the ` +
        'deploy again: once the value resolves at plan time it plans as a replace.',
    ),
  );
