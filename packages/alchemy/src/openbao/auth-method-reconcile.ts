/**
 * Bao.AuthMethod's read and reconcile as plain effects — split from auth-method.ts so the move runs
 * against a fake server. Same shape as mount-reconcile.ts; the one difference that matters is the
 * `auth/` prefix sys/remount needs (vault/logical_system.go:1295-1310 refuses to move an auth mount
 * to a non-auth path, and `token/` cannot move at all).
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import {
  type BaoAuthMethodAttributes,
  type BaoAuthMethodProps,
  attributesOf,
  authPath,
  matches,
  wantsTune,
} from './auth-method-form.ts';
import { enableAuthMethod, readAuthMethodData, tuneAuthMethod } from './auth-method-wire.ts';
import type { BaoError } from './bao-status.ts';
import { type MoveTarget, performMove, planMove } from './mount-move.ts';
import type { RemountError, RemountOptions } from './remount-wire.ts';

export const readMethod = (
  props: BaoAuthMethodProps,
): Effect.Effect<BaoAuthMethodAttributes | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const live = yield* readAuthMethodData(props.path);
    if (live === undefined) return undefined;
    return attributesOf(props, live);
  });

const moveTarget = (props: BaoAuthMethodProps): MoveTarget => ({
  family: 'Bao.AuthMethod',
  path: props.path,
  read: (path) => readMethod({ ...props, path }),
  type: props.type,
  wire: (path) => `auth/${authPath(path)}`,
});

/** Converge one auth method. `stated` is the path in Alchemy's state, if any. */
export const reconcileAuthMethod = (
  news: BaoAuthMethodProps,
  stated: string | undefined,
  options?: RemountOptions,
): Effect.Effect<BaoAuthMethodAttributes, BaoError | RemountError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const move = planMove('Bao.AuthMethod', stated, news.path, news.remountFrom);
    if (move.kind === 'refuse') return yield* Effect.die(new Error(move.message));
    if (move.kind === 'move') yield* performMove(moveTarget(news), move.from, options);

    let live = yield* readMethod(news);
    if (live === undefined) {
      yield* enableAuthMethod(news);
      if (wantsTune(news)) yield* tuneAuthMethod(news);
    } else if (!matches(live, news)) {
      if (live.type !== news.type) {
        return yield* Effect.die(
          new Error(
            `Bao.AuthMethod ${authPath(news.path)}: live type ${live.type} != ${news.type}. ` +
              'Auth method type is immutable — replace manually.',
          ),
        );
      }
      yield* tuneAuthMethod(news);
    }
    live = yield* readMethod(news);
    if (live === undefined) {
      return yield* Effect.die(
        new Error(
          `Bao.AuthMethod ${authPath(news.path)}: write returned no error but the method is still absent.`,
        ),
      );
    }
    return live;
  });
