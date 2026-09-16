import { Unowned } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import { Resource, type ResourceClass } from 'alchemy/Resource';
/**
 * `Cloudflare.R2BucketLock` — the lock rule set on one R2 bucket, declared rather than applied by
 * hand. A bucket lock is a RETENTION FLOOR: while a rule covers an object, no API call, no
 * lifecycle rule and no credential can delete it.
 *
 * 🔴 WHY THIS EXISTS AT ALL, AND WHAT IT REPLACES. a consuming stack shipped the retention floor as a
 *   documented `wrangler r2 bucket lock add …` step in the runbook, on the measured ground that
 *   `alchemy@2.0.0-beta.77` has no lock property anywhere in its R2 namespace. That measurement is
 *   still true and it was the wrong conclusion: a step a human runs once is a step an Alchemy plan
 *   can never show missing, so removing the floor by hand leaves that stack, its plan and
 *   every gate completely green. The operator's rule (2026-09-15) is to cover such a gap with a
 *   custom resource over the vendor's SDK, which is what this is.
 *
 * ⛔ THE SDK ALREADY HAD IT, AND THAT IS WORTH SAYING BECAUSE IT DECIDED THE SHAPE. Measured
 *   2026-09-15 in `cloudflare@4.5.0`, `resources/r2/buckets/locks.d.ts`:
 *
 *       update(bucketName: string, params: LockUpdateParams, options?): APIPromise<…>
 *       get(bucketName: string, params: LockGetParams, options?): APIPromise<LockGetResponse>
 *
 *   over `PUT`/`GET /accounts/{account_id}/r2/buckets/{bucket_name}/lock` with the jurisdiction
 *   carried as the `cf-r2-jurisdiction` header (`locks.mjs:17` and `:41`). So there is no raw
 *   `client.put` fallback here and no path string this package invented — the fallback the rule
 *   allows was not needed.
 *
 * ⚠️ THE RULE SET IS A REPLACE, NOT A MERGE. `PUT` takes the WHOLE list, exactly like R2's
 *   lifecycle rules — which is the trap a consuming stack records for
 *   `homeflare-git`. Declaring this resource on a bucket whose live rules nobody has read would
 *   drop them, so `read` fetches them first and `reconcile` refuses to write when they already
 *   match.
 */
import type Cloudflare from 'cloudflare';
import { NotFoundError } from 'cloudflare';
import * as Effect from 'effect/Effect';
import { CloudflareApi } from './client.ts';
import {
  type Jurisdiction,
  type R2LockRule,
  jurisdictionOf,
  rulesEqual,
  toBody,
} from './lock-rules.ts';
import type { Providers } from './providers.ts';

export interface R2BucketLockProps {
  readonly accountId: string;
  readonly bucketName: string;
  /** ⚠️ Part of the bucket's IDENTITY, not a preference — a bucket in another jurisdiction is another bucket. */
  readonly jurisdiction?: Jurisdiction;
  /**
   * ⛔ REQUIRED, AND ITS EMPTY VALUE IS THE DANGEROUS ONE. `rules: []` means NO FLOOR: it is what
   *   `delete` sends to take a lock off deliberately. An optional property would let a declaration
   *   that simply forgot it send `[]` and silently unlock the repository, reporting success — the
   *   same reasoning `LiteLLM.McpServer.allowedTools` is required for.
   */
  readonly rules: readonly R2LockRule[];
}

export type R2BucketLockAttributes = {
  readonly bucketName: string;
  readonly jurisdiction: Jurisdiction;
  readonly rules: readonly R2LockRule[];
};

export interface R2BucketLock extends Resource<
  'Cloudflare.R2BucketLock',
  R2BucketLockProps,
  R2BucketLockAttributes,
  never,
  Providers
> {}

// ⚠️ EXPLICIT ANNOTATION, REQUIRED BY isolatedDeclarations. This file was internal to a
//   monorepo before it was published; a published package emits its .d.ts from a separate
//   tsc pass, so every exported symbol must state its type rather than infer it.
export const R2BucketLock: ResourceClass<R2BucketLock> = Resource<R2BucketLock>(
  'Cloudflare.R2BucketLock',
  {
    /**
     * ⛔ RETAIN, AND ON THIS RESOURCE IT IS NOT THE ESTATE'S HABIT BUT THE WHOLE POINT. A lock is a
     *   safety floor: removing the declaration must not remove the floor, because the state it
     *   protects is the only physical backup of the estate's one Postgres. `delete` below is
     *   implemented — a provider that cannot delete cannot be tested or corrected — and it is
     *   reachable only by an operator running the CLI directly, past a deploy wrapper.
     */
    defaultRemovalPolicy: 'retain',
  },
);

/**
 * 🔴 A 404 HERE IS "NOTHING TO ADOPT", AND THE FIRST PLAN PROVED IT IS THE ORDINARY CASE.
 *   Measured 2026-09-15, an alchemy plan --detailed on a bucket that does not
 *   exist yet: `404 {"success":false,"errors":[{"code":10006,"message":"The specified bucket does
 *   not exist."}]}` — raised from `read`, during PLANNING, before anything is created. Alchemy
 *   calls `read` for a resource with no prior state, so on every first deploy the lock is asked
 *   about a bucket the same plan is about to create. Letting that throw makes the resource
 *   impossible to plan; swallowing it with `catchAll` would also hide a 403 from a mis-scoped
 *   token, which is the failure this estate spends the most time on. So: 404 → absent, everything
 *   else propagates.
 *
 * ⛔ AN EMPTY LIVE RULE SET IS "NO LOCK", NOT "A LOCK WITH NOTHING IN IT", so it reads as absent
 *   and the resource CREATES. The API answers `{}` for a bucket that has never been locked and
 *   `{ rules: [] }` for one whose rules were removed; both mean the floor is gone.
 * ⚠️ `Unowned` UNTIL THIS STACK HAS WRITTEN IT. A lock someone applied by hand — which is exactly
 *   what the retired runbook step did — must not be silently rewritten by a mistyped declaration;
 *   the planner refuses until the resource is piped through `adopt(true)`, which is one line an
 *   operator reads in the diff. An adopted rule set that already MATCHES then costs no request at
 *   all, because `reconcile` below returns before writing.
 */
export const readLock = (
  client: Cloudflare,
  props: { accountId: string; bucketName: string; jurisdiction?: Jurisdiction },
  written: boolean,
): Effect.Effect<R2BucketLockAttributes | undefined> =>
  Effect.gen(function* () {
    const jurisdiction = jurisdictionOf(props);
    const live = yield* Effect.tryPromise({
      try: () =>
        client.r2.buckets.locks.get(props.bucketName, {
          account_id: props.accountId,
          jurisdiction,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof NotFoundError,
        () => Effect.succeed(undefined),
      ),
      Effect.orDie,
    );
    if (live === undefined) return undefined;
    const rules = (live.rules ?? []) as readonly R2LockRule[];
    if (rules.length === 0) return undefined;
    const attributes: R2BucketLockAttributes = {
      bucketName: props.bucketName,
      jurisdiction,
      rules,
    };
    return written ? attributes : Unowned(attributes);
  });

/**
 * ⛔ A NO-OP MAKES NO REQUEST, AND ON A LOCK THAT MATTERS MORE THAN TIDINESS. `PUT` replaces the
 *   rule set; re-sending an identical one on every deploy is a write against the only thing
 *   standing between this repository and a delete, for no change. `output` is what the last deploy
 *   persisted (or what `read` just adopted), so the comparison costs nothing either.
 */
export const reconcileLock = (
  client: Cloudflare,
  news: R2BucketLockProps,
  output: R2BucketLockAttributes | undefined,
): Effect.Effect<R2BucketLockAttributes> =>
  Effect.gen(function* () {
    const jurisdiction = jurisdictionOf(news);
    if (output !== undefined && rulesEqual(output.rules, news.rules)) return output;
    yield* Effect.promise(() =>
      client.r2.buckets.locks.update(news.bucketName, {
        account_id: news.accountId,
        jurisdiction,
        ...toBody(news.rules),
      }),
    );
    return { bucketName: news.bucketName, jurisdiction, rules: news.rules };
  });

/**
 * ⛔ DELETING THIS RESOURCE MEANS PUTTING AN EMPTY RULE SET, WHICH IS UNLOCKING THE BUCKET. It is
 *   implemented because the retirement path is real — R2 refuses to empty a bucket while any lock
 *   rule is configured, so retiring the repository has to start here — and it is behind
 *   `defaultRemovalPolicy: 'retain'` and the estate CLI's refusal of `destroy` precisely because
 *   no ordinary deploy should ever reach it.
 */
export const deleteLock = (
  client: Cloudflare,
  output: R2BucketLockAttributes,
  accountId: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      client.r2.buckets.locks.update(output.bucketName, {
        account_id: accountId,
        jurisdiction: output.jurisdiction,
        rules: [],
      }),
    );
  });

export const R2BucketLockProvider = () =>
  Provider.effect(
    R2BucketLock,
    Effect.gen(function* () {
      const client = yield* CloudflareApi;
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
          return yield* readLock(client, props, output !== undefined);
        }),
        reconcile: Effect.fn(({ news, output }) => reconcileLock(client, news, output)),
        delete: Effect.fn(({ olds, output }) => deleteLock(client, output, olds.accountId)),
      });
    }),
  );
