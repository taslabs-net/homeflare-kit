/**
 * Rename safety for the families whose identity is a name, or a mount and a name: Bao.Policy,
 * Bao.CloudflareRole and Bao.ProxmoxRole. REPLACE.md has the audit and what each answer does.
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
 * ⚠️ UNDER `retain` THE OLD OBJECT STAYS LIVE. Apply.ts:2164-2173 skips the old generation's delete
 *   and logs "Retaining replaced resource (removal policy: retain)". The plan still says `replace`
 *   and the apply says what it kept, so it is no longer silent, but the old object is unmanaged
 *   from then on. Remove it by hand, or opt into `RemovalPolicy.destroy()`.
 */
import * as Effect from 'effect/Effect';

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

/** A role's API path from a diff's `news`, once both `mount` and `name` are resolved. */
export const declaredRolePath = (
  news: unknown,
  rolePath: (mount: string, name: string) => string,
): string | undefined => {
  const mount = declaredString(news, 'mount');
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
 * Whether the declared identity names a different object than the one in state: `true` → plan
 * `replace`; `false` → the same object; `undefined` → not knowable yet, because the declared side is
 * still an Output. `key` is how the SERVER keys the object (`policyKey`); the default is exact,
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
  key: (identity: string) => string = (identity) => identity,
): boolean | undefined => (declared === undefined ? undefined : key(stored) !== key(declared));

/**
 * Reconcile's guard: an `update` whose prior attributes name another object.
 *
 * ★ REACHED ONLY WHEN THE DIFF COULD NOT SEE THE NEW IDENTITY at plan time. A fresh create, and the
 *   new generation of a `replace`, both reach reconcile with `output` undefined (Apply.ts passes
 *   `output: attr`, which is empty for a new generation). An `update` reaches it with the previous
 *   generation's attributes.
 * ★ THE FAILED DEPLOY SETTLES ITSELF. Apply has already committed the row as `updating`, with the new
 *   props and the OLD attributes. By the next plan the upstream Output has landed, so the diff sees
 *   both names and answers `replace`. The old object is then deleted, or retained, by the removal
 *   policy, with no hand repair.
 */
export const refuseMovedUpdate = (family: string, from: string, to: string) =>
  Effect.die(
    new Error(
      `${family}: planned as an update, but its identity moved from ${from} to ${to}. Writing ` +
        `${to} now would leave ${from} live with no state record. Nothing was written. Run the ` +
        'deploy again: once the value resolves at plan time it plans as a replace.',
    ),
  );
