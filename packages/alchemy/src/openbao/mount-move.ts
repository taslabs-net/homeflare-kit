/**
 * What a changed path means for Bao.Mount and Bao.AuthMethod — and the move, when one is declared.
 *
 * ⛔ A CHANGED PATH USED TO PLAN `update` AND ENABLE AN EMPTY MOUNT AT THE NEW PATH. diff read the
 *   new path, found nothing, answered `update`, and reconcile ran `enable` there: a fresh, empty
 *   `kv2/` beside the retained `kv/` that still held every secret, with Alchemy's state now naming
 *   only the empty one. Nothing failed, so nothing said so (site-config plan, Guards).
 * ★ NOW A CHANGED PATH FAILS AT PLAN TIME, unless the declaration says where it came from:
 *   `remountFrom: '<old path>'` moves the mount with `sys/remount` (remount-wire.ts), which keeps
 *   every secret. A genuinely new, empty mount is a new resource id, never an edited path.
 * ★ THE MOVE IS DECIDED BY LIVE STATE, SO A RE-RUN CONVERGES. Source present and target absent is
 *   a move; target present and source absent is a move that already happened; both present, or
 *   neither, is a refusal — "neither" in particular is exactly the empty-mount failure above.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { BaoError } from './bao-status.ts';
import { mountPath } from './mount-form.ts';
import { type RemountError, type RemountOptions, remountAndWait } from './remount-wire.ts';

export type Move =
  | { readonly kind: 'stay' }
  | { readonly kind: 'move'; readonly from: string }
  | { readonly kind: 'refuse'; readonly message: string };

/**
 * @param family  `Bao.Mount` or `Bao.AuthMethod`, for the message.
 * @param stated  the path Alchemy's state holds, or undefined on a first reconcile.
 * @param path    the declared path.
 * @param remountFrom the declared source, if any.
 */
export const planMove = (
  family: string,
  stated: string | undefined,
  path: string,
  remountFrom: string | undefined,
): Move => {
  const to = mountPath(path);
  const from = remountFrom === undefined ? undefined : mountPath(remountFrom);
  if (stated === undefined) {
    return from === undefined || from === to ? { kind: 'stay' } : { kind: 'move', from };
  }
  const was = mountPath(stated);
  if (was === to) return { kind: 'stay' };
  if (from === undefined) {
    return {
      kind: 'refuse',
      message:
        `${family}: path changed from ${was} to ${to}. That would enable an EMPTY mount at ${to} ` +
        `and strand everything under ${was}. To move it with its data, declare ` +
        `\`remountFrom: '${was}'\` (leases under it are revoked; policies are not rewritten). ` +
        'For a new, empty mount, give it a new resource id instead.',
    };
  }
  if (from !== was) {
    return {
      kind: 'refuse',
      message: `${family}: remountFrom is ${from}, but the mount in state is ${was}.`,
    };
  }
  return { kind: 'move', from };
};

export interface MoveTarget {
  readonly family: string;
  /** Declared path, bare. */
  readonly path: string;
  readonly type: string;
  /** Read one path's live entry — undefined when absent. */
  readonly read: (
    path: string,
  ) => Effect.Effect<{ readonly type: string } | undefined, BaoError, HttpClient.HttpClient>;
  /** The path as sys/remount takes it: the bare path for secrets, `auth/<path>` for auth. */
  readonly wire: (path: string) => string;
}

const refuse = (message: string) => Effect.die(new Error(message));

/** Perform a planned move, deciding by live state. Returns once the target is in place. */
export const performMove = (
  target: MoveTarget,
  from: string,
  options?: RemountOptions,
): Effect.Effect<void, BaoError | RemountError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const to = mountPath(target.path);
    const source = yield* target.read(from);
    const landed = yield* target.read(to);
    if (source !== undefined && landed !== undefined) {
      return yield* refuse(
        `${target.family}: both ${from} and ${to} exist, so remountFrom cannot move one onto the ` +
          'other. Decide which holds the data, and retire the other by hand.',
      );
    }
    if (source === undefined && landed === undefined) {
      return yield* refuse(
        `${target.family}: remountFrom ${from} names no mount, and ${to} does not exist either. ` +
          'Refusing to enable an empty mount where data was expected.',
      );
    }
    if (source === undefined) return; // ★ Already moved — an interrupted apply re-running.
    if (source.type !== target.type) {
      return yield* refuse(
        `${target.family}: ${from} is type ${source.type}, not ${target.type}. A remount keeps the ` +
          'type; fix the declaration first.',
      );
    }
    const confirm = Effect.map(
      Effect.all([target.read(from), target.read(to)]),
      ([gone, there]) => gone === undefined && there !== undefined,
    );
    yield* remountAndWait(target.wire(from), target.wire(to), confirm, options);
  });
