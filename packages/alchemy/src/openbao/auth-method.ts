/**
 * An OpenBao auth method — path, type, description and lease TTLs.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts. This enables `approle` (or jwt/oidc)
 *   as a mount. Role ids, OIDC client secrets, and secret_ids are out of scope.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — disabling a method destroys every role under it
 *   and revokes tokens minted through those roles. Opt in with
 *   `.pipe(RemovalPolicy.destroy())`.
 *
 * ★ REPLACE SEMANTICS (audited 2026-09-21, see REPLACE.md): `type` changed → plans `replace`, whose
 *   create half dies on the still-occupied path before any write, so the apply fails and nothing is
 *   disabled (auth-method-reconcile.ts); `path` changed → FAILS unless `remountFrom` names the old
 *   path (then an in-place move). It used to plan `update` and enable an empty method at the new
 *   path, exactly as Bao.Mount did.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import {
  type BaoAuthMethodAttributes,
  type BaoAuthMethodProps,
  matches,
} from './auth-method-form.ts';
import { readMethod, reconcileAuthMethod } from './auth-method-reconcile.ts';
import { disableAuthMethod } from './auth-method-wire.ts';
import { planMove } from './mount-move.ts';

export type { BaoAuthMethodAttributes, BaoAuthMethodProps };

export interface BaoAuthMethod extends Resource<
  'Bao.AuthMethod',
  BaoAuthMethodProps,
  BaoAuthMethodAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoAuthMethod = Resource<BaoAuthMethod>('Bao.AuthMethod', {
  defaultRemovalPolicy: 'retain',
});

export const BaoAuthMethodProvider = () =>
  Provider.effect(
    BaoAuthMethod,
    Effect.succeed(
      BaoAuthMethod.Provider.of({
        /**
         * ⛔ `bao auth list` IS NOT A LIST OF THINGS THIS OWNS. `token/` is always
         *   present. Returning it would invite Alchemy to adopt — and then disable —
         *   methods it never created.
         */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          return yield* readMethod(olds);
        }),

        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          /**
           * ⛔ A CHANGED PATH FAILS HERE unless `remountFrom` names the old one — the same trap
           *   Bao.Mount had: reading the new path finds nothing, plans `update`, and enables an
           *   EMPTY method beside the retained one, with every role left behind (mount-move.ts).
           */
          const move = planMove('Bao.AuthMethod', output.path, news.path, news.remountFrom);
          if (move.kind === 'refuse') return yield* Effect.die(new Error(move.message));
          if (move.kind === 'move') return { action: 'update' } as const;
          const live = yield* readMethod(news);
          if (live === undefined) return { action: 'update' } as const;
          /**
           * ⛔ A CHANGED `type` IS A REPLACE. Delete is an auth disable — every role
           *   under the method dies. `retain` guards both orphan-delete and replace
           *   (same Alchemy Apply.ts path Bao.Mount documents).
           */
          if (live.type !== news.type) return { action: 'replace' } as const;
          if (matches(live, news)) return { action: 'noop' } as const;
          return { action: 'update' } as const;
        }),

        /** The body, and the move, live in auth-method-reconcile.ts. */
        reconcile: Effect.fn(function* ({ news, output }) {
          return yield* reconcileAuthMethod(news, output?.path);
        }),

        /**
         * ⛔ DISABLING A METHOD DESTROYS EVERY ROLE UNDER IT. Idempotent as Alchemy
         *   requires — already gone is success — but retain is the default for a reason.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* disableAuthMethod(output.path);
          return undefined;
        }),
      }),
    ),
  );
