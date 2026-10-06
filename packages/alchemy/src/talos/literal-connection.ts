/**
 * Runtime refusal of a `talos-openbao` connection that is not a plain literal.
 *
 * ⛔ A RESOURCE THAT TAKES A `connection` PROP MUST CALL THIS IN `diff`, WHERE THE PROP IS STILL
 *   AN `Input`. By `read`/`reconcile` the engine has resolved an Output to its current string, so
 *   the same check there can no longer tell a literal from an Output: the refusal only works
 *   before resolution. An Output in the connection is unresolved at plan time, upstream plans an
 *   UPDATE for every workload on it, and reconcile replays the old cluster's deletes on the new
 *   one (`talosOpenBaoConnection` in cluster-adapter.ts).
 */
import { hasUnresolvedInputs } from 'alchemy/Diff';
import * as Effect from 'effect/Effect';
import { TalosUidNotLiteral } from './cluster-adapter-errors.ts';

/**
 * The typed refusal unless `connection` is `{ auth: { kind, uid: literal } }`, else `undefined`.
 * ★ A value, never a throw: a throw inside `Effect.gen` would become a defect, not a failure.
 */
export const literalConnectionRefusal = (connection: unknown): TalosUidNotLiteral | undefined => {
  const auth = (connection as { auth?: { uid?: unknown } } | undefined)?.auth;
  return hasUnresolvedInputs(connection) || typeof auth?.uid !== 'string' || auth.uid === ''
    ? new TalosUidNotLiteral({})
    : undefined;
};

/**
 * ⛔ THE `diff` GUARD ALONE IS NOT ENOUGH (round-4 review): alchemy skips `diff` for a FRESH
 *   resource whose inputs are unresolved, and reconcile then copies the resolved string downstream
 *   — an Output uid slips through on exactly the first deploy. So the same refusal runs when the
 *   resource is DECLARED, before any input resolution, by wrapping its constructor.
 * ★ A Proxy over the class (not a new function) keeps `.Provider`, `.Self`, `.ref` and the type.
 *   Plain props fail the declaring Effect; a props Effect fails once it yields.
 */
export const withLiteralConnection = <C extends (...args: never[]) => unknown>(resource: C): C =>
  new Proxy(resource, {
    apply: (target, thisArg, args: unknown[]) => {
      const refusal = (given: unknown) =>
        literalConnectionRefusal((given as { connection?: unknown } | undefined)?.connection);
      const props = args[1];
      if (Effect.isEffect(props)) {
        const checked = props.pipe(
          Effect.flatMap((resolved) => {
            const refused = refusal(resolved);
            return refused === undefined ? Effect.succeed(resolved) : Effect.fail(refused);
          }),
        );
        return Reflect.apply(target, thisArg, [args[0], checked, ...args.slice(2)]);
      }
      const refused = refusal(props);
      return refused === undefined ? Reflect.apply(target, thisArg, args) : Effect.fail(refused);
    },
  });
