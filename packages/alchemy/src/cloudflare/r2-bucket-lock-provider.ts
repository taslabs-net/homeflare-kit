/**
 * `Cloudflare.R2BucketLock`'s provider registration — split out of `r2-bucket-lock.ts` (S3) so
 * that file stays under the house's 250-line cap once `readLock`/`reconcileLock`/`deleteLock`
 * carry their own typed-error wiring (see `r2-bucket-lock-errors.ts`).
 */
import { Credentials } from '@distilled.cloud/cloudflare/Credentials';
import type { CloudflareOpContext } from '@distilled.cloud/cloudflare/r2';
import * as Provider from 'alchemy/Provider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { R2BucketLock, deleteLock, readLock, reconcileLock } from './r2-bucket-lock.ts';

export const R2BucketLockProvider = () =>
  Provider.effect(
    R2BucketLock,
    Effect.gen(function* () {
      // ★ CAPTURED AT BUILD, LIKE `MeshNodeProvider`. `Credentials` and `HttpClient.HttpClient`
      //   are the whole of distilled's `CloudflareOpContext` (r2.ts re-exports the type); pinning
      //   them here rather than reading ambient context inside each handler keeps this provider
      //   correct whether or not the stack also merges `Cloudflare.providers()`.
      const services = Context.make(Credentials, yield* Credentials).pipe(
        Context.add(HttpClient.HttpClient, yield* HttpClient.HttpClient),
      );
      const run = <A, E>(effect: Effect.Effect<A, E, CloudflareOpContext>) =>
        Effect.provideContext(effect, services);

      return R2BucketLock.Provider.of({
        /**
         * ⛔ EMPTY, AND ALCHEMY'S OWN CONTRACT ASKS FOR EXACTLY THAT. `ProviderService.list`:
         *   "Resources with no native enumeration API (… sub-resources keyed entirely by a parent)
         *   should return an empty array rather than throwing." There is no list-locks endpoint —
         *   a lock is reachable only through the bucket that owns it — so enumerating would mean
         *   listing every bucket in the account and GETting each one's lock.
         * ⛔⛔ AND `nuke.singleton` IS WHY THAT IS NOT MERELY UNAVAILABLE BUT UNWANTED. `list`
         *   feeds `alchemy unsafe nuke`, which lists and then deletes; `delete` here is an UNLOCK.
         *   A working enumeration would hand one command the ability to strip the retention floor
         *   off every bucket in the account — the precise event a floor exists to make impossible.
         *   `singleton` is the documented word for it: always-present configuration whose delete
         *   resets rather than removes.
         */
        list: () => Effect.succeed([]),
        nuke: { singleton: true },
        read: Effect.fn(function* ({ olds, output }) {
          const props = olds ?? undefined;
          if (props === undefined) return undefined;
          return yield* run(readLock(props, output !== undefined));
        }),
        reconcile: Effect.fn(({ news, output }) => run(reconcileLock(news, output))),
        delete: Effect.fn(({ olds, output }) => run(deleteLock(output, olds.accountId))),
      });
    }),
  );
