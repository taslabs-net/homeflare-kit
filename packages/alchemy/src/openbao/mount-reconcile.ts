/**
 * Bao.Mount's read and reconcile as plain effects — split from mount.ts so the move (and its
 * refusals) run against a fake server, not only in a reviewer's head.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { Claim } from '../ownership/adopt.ts';
import type { BaoError } from './bao-status.ts';
import {
  type BaoMountAttributes,
  type BaoMountProps,
  attributesOf,
  matches,
  mountPath,
  wantsTune,
} from './mount-form.ts';
import { type MoveTarget, performMove, planMove } from './mount-move.ts';
import { enableMount, readMountData, tuneMount } from './mount-wire.ts';
import type { RemountError, RemountOptions } from './remount-wire.ts';

export const readMount = (
  props: BaoMountProps,
): Effect.Effect<BaoMountAttributes | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const live = yield* readMountData(props.path);
    if (live === undefined) return undefined;
    return attributesOf(props, live);
  });

const moveTarget = (props: BaoMountProps): MoveTarget => ({
  family: 'Bao.Mount',
  path: props.path,
  read: (path) => readMount({ ...props, path }),
  type: props.type,
  wire: mountPath,
});

/**
 * Converge one mount. `stated` is the path in Alchemy's state (undefined on a first reconcile).
 * Dies on a refusal; fails with OpenBao's own error on a refused call.
 * ⛔ `claim` (mount.ts always passes it) refuses, before any write, a first reconcile that would take
 *   over a live mount: the one at the path, or the `remountFrom` source it would move
 *   (ownership/adopt.ts).
 */
export const reconcileMount = (
  news: BaoMountProps,
  stated: string | undefined,
  options?: RemountOptions,
  claim?: Claim,
): Effect.Effect<BaoMountAttributes, BaoError | RemountError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const move = planMove('Bao.Mount', stated, news.path, news.remountFrom);
    if (move.kind === 'refuse') return yield* Effect.die(new Error(move.message));
    const first = stated === undefined ? claim : undefined;
    if (first !== undefined && move.kind === 'move') {
      const source = yield* readMount({ ...news, path: move.from });
      if (source !== undefined) yield* first(`Bao.Mount ${move.from} (the remountFrom source)`);
    }
    if (move.kind === 'move') yield* performMove(moveTarget(news), move.from, options);

    let live = yield* readMount(news);
    if (live === undefined) {
      yield* enableMount(news);
      if (wantsTune(news)) yield* tuneMount(news);
    } else {
      if (live.type !== news.type) {
        return yield* Effect.die(
          new Error(
            `Bao.Mount ${mountPath(news.path)}: live type ${live.type} != ${news.type}. ` +
              'Secrets engine type is immutable — replace manually.',
          ),
        );
      }
      if (first !== undefined) yield* first(`Bao.Mount ${mountPath(news.path)}`);
      if (!matches(live, news)) yield* tuneMount(news);
    }
    live = yield* readMount(news);
    if (live === undefined) {
      return yield* Effect.die(
        new Error(
          `Bao.Mount ${mountPath(news.path)}: write returned no error but the mount is still absent.`,
        ),
      );
    }
    return live;
  });
