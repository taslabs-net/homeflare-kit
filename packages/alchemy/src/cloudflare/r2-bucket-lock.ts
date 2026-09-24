import { Unowned } from 'alchemy/AdoptPolicy';
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
 * ★ OVER `@distilled.cloud/cloudflare/r2`, THE SAME SDK `Cloudflare.MeshNode` USES
 *   (mesh-node-api.ts), NOT THE `cloudflare` NPM SDK THIS RESOURCE USED TO CALL. Measured
 *   2026-09-23 in distilled `1.0.0-rc.12` (the version alchemy@2.0.0-beta.79 pins),
 *   `packages/cloudflare/src/services/r2.ts`: `getBucketLock` / `putBucketLock` cover the same
 *   `GET`/`PUT /accounts/{account_id}/r2/buckets/{bucket_name}/lock` route the old SDK's
 *   `r2.buckets.locks.get`/`.update` did — same `rules[]` body, the `cf-r2-jurisdiction` header
 *   spelled as the `jurisdiction` field — but typed as `NoSuchBucket | InvalidRoute |
 *   CloudflareRateLimited | CloudflareError` instead of an opaque HTTP status, so the "bucket
 *   does not exist yet" case below is `catchTag('NoSuchBucket', …)`, never a status check. This
 *   is also the swap that lets `client.ts` (the hand-rolled `cloudflare@4.5.0` wrapper) go away:
 *   nothing else in the kit imported it.
 *
 * ⚠️ THE RULE SET IS A REPLACE, NOT A MERGE. `PUT` takes the WHOLE list, exactly like R2's
 *   lifecycle rules — which is the trap a consuming stack records for
 *   `homeflare-git`. Declaring this resource on a bucket whose live rules nobody has read would
 *   drop them, so `read` fetches them first and `reconcile` refuses to write when they already
 *   match.
 */
import type { CloudflareOpContext } from '@distilled.cloud/cloudflare/r2';
import * as r2 from '@distilled.cloud/cloudflare/r2';
import * as Effect from 'effect/Effect';
import {
  type Jurisdiction,
  type R2LockRule,
  jurisdictionOf,
  rulesEqual,
  toBody,
} from './lock-rules.ts';
import type { Providers } from './providers.ts';
import { R2BucketLockRefusal } from './r2-bucket-lock-errors.ts';

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
 *   about a bucket the same plan is about to create. Code 10006 is exactly distilled's
 *   `NoSuchBucket` tag (r2.ts's error matcher, `[{ code: 10006 }]`), so `catchTag` on it is the
 *   same case the status check used to cover — but by the vendor's own error identity, not by
 *   reading a number off the response. Letting it propagate would make the resource impossible to
 *   plan; swallowing every failure would also hide a 403 from a mis-scoped token, which is the
 *   failure this estate spends the most time on. So: `NoSuchBucket` → absent, everything else is a
 *   typed `R2BucketLockRefusal` (S20; decision 49) — never a status check, and, since 2026-09-24,
 *   never `Effect.orDie` either. See `r2-bucket-lock-errors.ts`.
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
  props: { accountId: string; bucketName: string; jurisdiction?: Jurisdiction },
  written: boolean,
): Effect.Effect<R2BucketLockAttributes | undefined, R2BucketLockRefusal, CloudflareOpContext> =>
  Effect.gen(function* () {
    const jurisdiction = jurisdictionOf(props);
    const live = yield* r2
      .getBucketLock({ accountId: props.accountId, bucketName: props.bucketName, jurisdiction })
      .pipe(
        Effect.catchTag('NoSuchBucket', () => Effect.succeed(undefined)),
        Effect.mapError(
          (cause) =>
            new R2BucketLockRefusal({ operation: 'read', bucketName: props.bucketName, cause }),
        ),
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
 * ⛔ `NoSuchBucket` IS NOT CAUGHT HERE. Unlike `read`, a `reconcile` that hits it means the bucket
 *   this declaration names is genuinely gone — that is a real failure to surface, not a case to
 *   paper over, so it fails like every other tagged error `putBucketLock` can raise: as a typed
 *   `R2BucketLockRefusal`, never as the `Effect.orDie` defect that used to crash the whole engine.
 */
export const reconcileLock = (
  news: R2BucketLockProps,
  output: R2BucketLockAttributes | undefined,
): Effect.Effect<R2BucketLockAttributes, R2BucketLockRefusal, CloudflareOpContext> =>
  Effect.gen(function* () {
    const jurisdiction = jurisdictionOf(news);
    if (output !== undefined && rulesEqual(output.rules, news.rules)) return output;
    yield* r2
      .putBucketLock({
        accountId: news.accountId,
        bucketName: news.bucketName,
        jurisdiction,
        ...toBody(news.rules),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new R2BucketLockRefusal({ operation: 'reconcile', bucketName: news.bucketName, cause }),
        ),
      );
    return { bucketName: news.bucketName, jurisdiction, rules: news.rules };
  });

/**
 * ⛔ DELETING THIS RESOURCE MEANS PUTTING AN EMPTY RULE SET, WHICH IS UNLOCKING THE BUCKET. It is
 *   implemented because the retirement path is real — R2 refuses to empty a bucket while any lock
 *   rule is configured, so retiring the repository has to start here — and it is behind
 *   `defaultRemovalPolicy: 'retain'` and the estate CLI's refusal of `destroy` precisely because
 *   no ordinary deploy should ever reach it.
 * ⛔ IDEMPOTENT (S11, P10): a bucket that is already gone has nothing left to unlock, so
 *   `NoSuchBucket` is a success here, not a refusal — the one case `delete` treats specially,
 *   the mirror image of `read`'s own `NoSuchBucket` catch above.
 */
export const deleteLock = (
  output: R2BucketLockAttributes,
  accountId: string,
): Effect.Effect<void, R2BucketLockRefusal, CloudflareOpContext> =>
  Effect.gen(function* () {
    yield* r2
      .putBucketLock({
        accountId,
        bucketName: output.bucketName,
        jurisdiction: output.jurisdiction,
        rules: [],
      })
      .pipe(
        Effect.catchTag('NoSuchBucket', () => Effect.void),
        Effect.mapError(
          (cause) =>
            new R2BucketLockRefusal({
              operation: 'delete',
              bucketName: output.bucketName,
              cause,
            }),
        ),
      );
  });
