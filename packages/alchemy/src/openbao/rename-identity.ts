/**
 * The rename guard every Bao.* family whose identity is a name, a mount, or a catalog key shares:
 * one `Identity` per family, and two steps built from rename.ts, `judgeRename` at the top of `diff`
 * and `guardRename` at the top of `reconcile`. REPLACE.md has the audit behind both.
 *
 * ★ ONE DESCRIPTION OF "WHICH OBJECT", NOT TWELVE COPIES OF THE CHECK. The rename-safety fix went
 *   in family by family, and the families it skipped were the ones that kept the bug: nine of them
 *   judged the identity only after `isResolved(news)` and never asked whether the new path was
 *   taken. 🔴 MEASURED 2026-09-21 through the engine (rename-families.test.ts): two Bao.AuthRole,
 *   Bao.PkiRole, Bao.JwtRole, Bao.KubernetesRole, Bao.SshRole or Bao.Plugin resources that swapped
 *   names under `RemovalPolicy.destroy()` both planned `replace`, each wrote over the other, and
 *   both old deletes then removed what had just been written: a green deploy, both objects gone.
 *   With any other prop still an Output, all nine planned `update` and left the old object live
 *   under no state record; for Bao.MfaTotpMethod that wrote a second method and stranded every
 *   enrolment.
 */
import * as Effect from 'effect/Effect';
import {
  declaredRolePath,
  declaredString,
  isMoved,
  judgeMove,
  refuseMovedUpdate,
} from './rename.ts';

/** How one family names the object it manages — the thing a rename changes. */
export interface Identity<A> {
  /** `Bao.JwtRole` etc., for messages. */
  readonly family: string;
  /** The identity a set of props declares; undefined while any part of it is still an Output. */
  readonly declared: (props: unknown) => string | undefined;
  /** The identity a generation's attributes record. */
  readonly recorded: (output: A) => string;
  /** The API path an identity is read at, for the occupied check. Default: the identity. */
  readonly pathOf?: ((identity: string) => string) | undefined;
  /** How the server keys it (`policyKey`). Default: exact. */
  readonly key?: ((identity: string) => string) | undefined;
}

/** A family keyed by `name` alone, read at `pathOf(name)`. */
export const nameIdentity = <A extends { readonly name: string }>(
  family: string,
  pathOf: (name: string) => string,
  key?: (name: string) => string,
): Identity<A> => ({
  declared: (props) => declaredString(props, 'name'),
  family,
  key,
  pathOf,
  recorded: (output) => output.name,
});

/**
 * A role at `rolePath(mount, name)`; the identity is that path. `defaultMount` is what an absent
 * `mount` prop means — undefined when `mount` is required.
 */
export const roleIdentity = <A extends { readonly mount: string; readonly name: string }>(
  family: string,
  rolePath: (mount: string, name: string) => string,
  defaultMount?: string,
  key?: (path: string) => string,
): Identity<A> => ({
  declared: (props) => declaredRolePath(props, rolePath, defaultMount),
  family,
  key,
  recorded: (output) => rolePath(output.mount, output.name),
});

/**
 * ⚠️ THE LAST SEGMENT LOWERCASED: a role store that folds the name and not the mount. openbao v2.6.2
 *   AppRole (builtin/credential/approle/path_role.go:1485, :1537) and Kubernetes
 *   (builtin/credential/kubernetes/backend.go:362, path_role.go:396) both store `role/<lowercased
 *   name>`, and JWT reads its `name` as a TypeLowerCaseString (builtin/credential/jwt/path_role.go:77),
 *   while the router folds no case in a mount path. So `Host` → `host` is the same role, never a
 *   replace that would delete, under `destroy`, the role it had just written.
 */
export const foldName = (path: string): string =>
  path.replace(/[^/]+$/, (name) => name.toLowerCase());

/**
 * `diff`'s first step, before `isResolved(news)`: the move from the identity this resource last
 * wrote or tried to the declared one, or undefined when both name the same object or either is not
 * known yet. ⛔ Fails the plan when the new identity is already taken (`judgeMove`).
 *
 * ★ `olds` STANDS IN FOR `output` WHILE A CREATE OR A REPLACEMENT IS UNFINISHED, which is what
 *   catches reverting a move whose new generation failed (rename.ts, `judgeMove`).
 */
export const judgeRename = <A>(
  identity: Identity<A>,
  olds: unknown,
  news: unknown,
  output: A | undefined,
) =>
  judgeMove(
    identity.family,
    output === undefined ? identity.declared(olds) : identity.recorded(output),
    identity.declared(news),
    identity.pathOf ?? ((path) => path),
    identity.key,
  );

/**
 * `reconcile`'s first step: an `update` whose prior attributes name another object dies before any
 * read or write (`refuseMovedUpdate`). Only reached when the diff could not see the new identity.
 */
export const guardRename = <A>(
  identity: Identity<A>,
  news: unknown,
  output: A | undefined,
): Effect.Effect<void> => {
  if (output === undefined) return Effect.void;
  const from = identity.recorded(output);
  const to = identity.declared(news);
  return to !== undefined && isMoved(from, to, identity.key) === true
    ? refuseMovedUpdate(identity.family, from, to)
    : Effect.void;
};
