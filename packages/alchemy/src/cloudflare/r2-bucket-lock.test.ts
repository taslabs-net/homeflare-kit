/**
 * `readLock` / `reconcileLock` / `deleteLock` against the fake Cloudflare in fake-r2-lock.ts, the
 * same direct style mesh-node-token.test.ts uses for `fetchMeshNodeToken`: run the plain Effect
 * under `fakeR2LockLayer`, no Provider or engine harness needed.
 *
 * ★ THE POINT OF THIS FILE IS THE TAGGED-ERROR PATHS, per the transport swap onto
 *   `@distilled.cloud/cloudflare/r2`: `NoSuchBucket` is matched by Cloudflare's own error code
 *   (10006), never by HTTP status, and only `readLock`/`deleteLock` treat it as "nothing to do" —
 *   `reconcileLock` still fails on it, but as a typed SDK error, not the `Effect.orDie`
 *   defect this family used to raise (WI-7, decision 49 "upstream wins", 2026-09-24).
 */
import * as Retry from '@distilled.cloud/cloudflare/Retry';
import type { CloudflareOpContext } from '@distilled.cloud/cloudflare/r2';
import { Unowned } from 'alchemy/AdoptPolicy';
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  FAKE_ACCOUNT,
  type FakeR2Lock,
  fakeFailure,
  fakeR2Lock,
  fakeR2LockLayer,
  writes,
} from './fake-r2-lock.ts';
import type { R2LockRule } from './lock-rules.ts';
import { type R2BucketLockProps, deleteLock, readLock, reconcileLock } from './r2-bucket-lock.ts';

const run = <A, E>(fake: FakeR2Lock, effect: Effect.Effect<A, E, CloudflareOpContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(fakeR2LockLayer(fake))));

/**
 * The operation's typed refusal, never a defect — asserts S20/S21 (WI-7). `Retry.none` keeps a
 * simulated 429 from actually waiting out distilled's real, unbounded-under-test throttling
 * backoff (`applyRetry`'s `makeDefault` in `@distilled.cloud/core/api.ts`) — the house's own
 * speed doctrine (S26, `testing-speed-doctrine`) never lets a test wait on a real retry schedule.
 */
const refused = <A, E>(fake: FakeR2Lock, effect: Effect.Effect<A, E, CloudflareOpContext>) =>
  Effect.runPromise(Effect.flip(effect).pipe(Retry.none, Effect.provide(fakeR2LockLayer(fake))));

const rule: R2LockRule = {
  id: 'keep-30d',
  enabled: true,
  condition: { type: 'Age', maxAgeSeconds: 2_592_000 },
};

const props = (over: Partial<R2BucketLockProps> = {}): R2BucketLockProps => ({
  accountId: FAKE_ACCOUNT,
  bucketName: 'my-backups',
  rules: [rule],
  ...over,
});

describe('readLock', () => {
  test('a bucket that does not exist (NoSuchBucket, code 10006) reads as absent', async () => {
    const fake = fakeR2Lock();
    expect(await run(fake, readLock(props(), false))).toBeUndefined();
  });

  test('a bucket that exists but was never locked reads as absent', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    expect(await run(fake, readLock(props(), false))).toBeUndefined();
  });

  test('a locked bucket, written by this stack, reads as plain attributes', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    await run(fake, reconcileLock(props(), undefined));
    const attrs = await run(fake, readLock(props(), true));
    expect(Unowned.is(attrs)).toBe(false);
    expect(attrs).toEqual({ bucketName: 'my-backups', jurisdiction: 'default', rules: [rule] });
  });

  test('a locked bucket, not yet written by this stack, reads Unowned', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    await run(fake, reconcileLock(props(), undefined));
    const attrs = await run(fake, readLock(props(), false));
    expect(Unowned.is(attrs)).toBe(true);
  });

  test('NoSuchBucket is matched by code, not by HTTP status', async () => {
    // ⛔ THE PROOF THAT THIS IS catchTag, NOT A STATUS CHECK: code 10006 at a non-404 status is
    //   still caught. The old `cloudflare` SDK's `instanceof NotFoundError` could only ever match
    //   a 404; distilled's error matcher does not look at status at all for this tag.
    const fake = fakeR2Lock({
      onRoute: () => fakeFailure(400, 10006, 'The specified bucket does not exist.'),
    });
    expect(await run(fake, readLock(props(), false))).toBeUndefined();
  });

  test('a different tagged error at 404 is NOT swallowed as NoSuchBucket', async () => {
    // ⛔ code 7003 is `InvalidRoute`, not `NoSuchBucket` — even at the same 404 status a plain
    //   status check would have treated as "no bucket". `catchTag('NoSuchBucket', …)` leaves it
    //   alone, and it now surfaces as a typed SDK error, never an `Effect.orDie` defect.
    const fake = fakeR2Lock({ onRoute: () => fakeFailure(404, 7003, 'Invalid route') });
    const refusal = await refused(fake, readLock(props(), false));
    expect(refusal._tag).toBe('InvalidRoute');
  });

  test('a rate-limited read surfaces as a typed refusal, not a crash', async () => {
    // ⛔ 429 WITH NO MATCHED CODE maps to distilled's `TooManyRequests` (protocol.ts step 3,
    //   "Throttling"), one of the `CloudflareOpError` members this resource does not special-case.
    const fake = fakeR2Lock({ onRoute: () => fakeFailure(429, 0, 'rate limited') });
    const refusal = await refused(fake, readLock(props(), false));
    expect(refusal._tag).toBe('TooManyRequests');
  });
});

describe('reconcileLock', () => {
  test('writes nothing when the declared rules already match', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    const output = await run(fake, reconcileLock(props(), undefined));
    fake.seen.length = 0;
    const again = await run(fake, reconcileLock(props(), output));
    expect(again).toEqual(output);
    expect(writes(fake)).toEqual([]);
  });

  test('PUTs the whole rule set when it differs from output', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    await run(fake, reconcileLock(props(), undefined));
    expect(writes(fake)).toEqual(['PUT']);
    expect(fake.locks.get('my-backups')).toEqual([rule]);
  });

  test('NoSuchBucket is NOT caught here: a genuinely missing bucket is a typed refusal', async () => {
    const fake = fakeR2Lock();
    const refusal = await refused(fake, reconcileLock(props(), undefined));
    expect(refusal._tag).toBe('NoSuchBucket');
  });
});

describe('deleteLock', () => {
  test('PUTs an empty rule set, unlocking the bucket', async () => {
    const fake = fakeR2Lock({ existingBuckets: ['my-backups'] });
    const output = await run(fake, reconcileLock(props(), undefined));
    fake.seen.length = 0;
    await run(fake, deleteLock(output, FAKE_ACCOUNT));
    expect(writes(fake)).toEqual(['PUT']);
    expect(fake.locks.has('my-backups')).toBe(false);
  });

  test('deleting when the bucket is already gone succeeds (S11, P10: delete is idempotent)', async () => {
    // ⛔ THE ONE BEHAVIOUR CHANGE WI-7 MAKES: unlike `reconcileLock`, `deleteLock` now catches
    //   `NoSuchBucket` into success — a bucket that no longer exists has nothing left to unlock.
    const fake = fakeR2Lock();
    const output = await run(
      fakeR2Lock({ existingBuckets: ['my-backups'] }),
      reconcileLock(props(), undefined),
    );
    await run(fake, deleteLock(output, FAKE_ACCOUNT));
    expect(writes(fake)).toEqual(['PUT']);
  });

  test('delete does not swallow InvalidRoute at 404', async () => {
    const fake = fakeR2Lock({ onRoute: () => fakeFailure(404, 7003, 'Invalid route') });
    const refusal = await refused(
      fake,
      deleteLock(
        { bucketName: 'my-backups', jurisdiction: 'default', rules: [rule] },
        FAKE_ACCOUNT,
      ),
    );
    expect(refusal._tag).toBe('InvalidRoute');
  });

  test('a rate-limited delete surfaces as a typed refusal, not a crash', async () => {
    const setup = fakeR2Lock({ existingBuckets: ['my-backups'] });
    const output = await run(setup, reconcileLock(props(), undefined));
    const limited = fakeR2Lock({
      existingBuckets: ['my-backups'],
      onRoute: () => fakeFailure(429, 0, 'rate limited'),
    });
    const refusal = await refused(limited, deleteLock(output, FAKE_ACCOUNT));
    expect(refusal._tag).toBe('TooManyRequests');
  });
});
