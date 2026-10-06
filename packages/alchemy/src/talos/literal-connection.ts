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
import { TalosUidNotLiteral } from './cluster-adapter-errors.ts';

/** Throws {@link TalosUidNotLiteral} unless `connection` is `{ auth: { kind, uid: literal } }`. */
export const assertLiteralConnection = (connection: unknown): void => {
  const auth = (connection as { auth?: { uid?: unknown } } | undefined)?.auth;
  if (hasUnresolvedInputs(connection) || typeof auth?.uid !== 'string' || auth.uid === '') {
    throw new TalosUidNotLiteral({});
  }
};
