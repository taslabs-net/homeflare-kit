/**
 * An OpenBao auth method — path, type, description and lease TTLs.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts. This enables `approle` (or jwt/oidc)
 *   as a mount. Role ids, OIDC client secrets, and secret_ids are out of scope.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — disabling a method destroys every role under it
 *   and revokes tokens minted through those roles. Opt in with
 *   `.pipe(RemovalPolicy.destroy())`.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
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
import {
  disableAuthMethod,
  enableAuthMethod,
  readAuthMethodData,
  tuneAuthMethod,
} from './auth-method-wire.ts';

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

const readMethod = (props: BaoAuthMethodProps) =>
  Effect.gen(function* () {
    const live = yield* readAuthMethodData(props.path);
    if (live === undefined) return undefined;
    return attributesOf(props, live);
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

        reconcile: Effect.fn(function* ({ news }) {
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
