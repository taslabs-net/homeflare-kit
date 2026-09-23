/**
 * `readLock` / `reconcileLock` / `deleteLock` against the fake Cloudflare in fake-r2-lock.ts, the
 * same direct style mesh-node-token.test.ts uses for `fetchMeshNodeToken`: run the plain Effect
 * under `fakeR2LockLayer`, no Provider or engine harness needed.
 *
 * ★ THE POINT OF THIS FILE IS THE TAGGED-ERROR PATHS, per the transport swap onto
 *   `@distilled.cloud/cloudflare/r2`: `NoSuchBucket` is matched by Cloudflare's own error code
 *   (10006), never by HTTP status, and only `readLock` treats it as "nothing to adopt" —
 *   `reconcileLock`/`deleteLock` let it die like any other tagged error.
 */
import type { CloudflareOpContext } from '@distilled.cloud/cloudflare/r2';
import { Unowned } from 'alchemy/AdoptPolicy';
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
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

const dies = <A, E>(fake: FakeR2Lock, effect: Effect.Effect<A, E, CloudflareOpContext>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(fakeR2LockLayer(fake))));

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
    //   alone, and `Effect.orDie` turns it into a defect.
    const fake = fakeR2Lock({ onRoute: () => fakeFailure(404, 7003, 'Invalid route') });
    const exit = await dies(fake, readLock(props(), false));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
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

  test('NoSuchBucket is NOT caught here: a genuinely missing bucket dies', async () => {
    const fake = fakeR2Lock();
    const exit = await dies(fake, reconcileLock(props(), undefined));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
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

  test('NoSuchBucket is NOT caught here either: a genuinely missing bucket dies', async () => {
    const fake = fakeR2Lock();
    const output = await run(
      fakeR2Lock({ existingBuckets: ['my-backups'] }),
      reconcileLock(props(), undefined),
    );
    const exit = await dies(fake, deleteLock(output, FAKE_ACCOUNT));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });
});
