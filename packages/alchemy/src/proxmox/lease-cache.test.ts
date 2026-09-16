/**
 * ★ BOTH DIRECTIONS ARE PINNED. A cache that never serves a hit is a slow no-op nobody notices; a
 *   cache that serves an expiring credential turns a 401 into "the object is absent", which is how
 *   a plan comes to say CREATE for something that exists. The margin is the whole safety property,
 *   so it is tested from both sides of its edge.
 *
 * ⛔ AND THE CONCURRENCY IS PINNED, BECAUSE THAT IS WHAT THE MEASUREMENT WAS ABOUT. 98 resources
 *   reached an empty cache in the same instant, and the hand-written cache this replaced was wrong
 *   only on the path where a mint fails — so that path is tested, not assumed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Cache from 'effect/Cache';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import type { PveCredential } from './credentials.ts';
import { type LeaseKey, makeLeases, timeToLive } from './lease-cache.ts';

const TB4: LeaseKey = {
  mount: 'proxmox-tb4',
  role: 'read',
  scheme: 'pve',
};
/** ⚠️ Same role as TB4, DIFFERENT mount — the collision the key has to survive. */
const OPS: LeaseKey = { ...TB4, mount: 'proxmox-ops' };

const cred = (tokenId: string, leaseSeconds: number): PveCredential => ({
  leaseSeconds,
  secret: 'not-a-real-secret',
  tokenId,
});

const keptSeconds = (exit: Exit.Exit<PveCredential, unknown>) =>
  Duration.toMillis(timeToLive(exit)) / 1000;

/** A mint that counts itself, takes a moment — so callers genuinely overlap — and does as told. */
const countingMint = (outcome: (call: number) => PveCredential | Error) => {
  let calls = 0;
  const mintFor = () =>
    Effect.gen(function* () {
      calls += 1;
      const result = outcome(calls);
      yield* Effect.sleep('10 millis');
      if (result instanceof Error) return yield* Effect.fail(result);
      return result;
    });
  return { calls: () => calls, mintFor };
};

const concurrently = <A, E>(times: number, effect: Effect.Effect<A, E>) =>
  Effect.all(
    Array.from({ length: times }, () => Effect.exit(effect)),
    { concurrency: 'unbounded' },
  );

describe('how long a lease is kept', () => {
  it('keeps a 300s provision lease for 240s — the last minute is the margin', () => {
    assert.equal(keptSeconds(Exit.succeed(cred('hf-provision@pve!a', 300))), 240);
  });

  it('keeps a lease one second past the margin for one second', () => {
    assert.equal(keptSeconds(Exit.succeed(cred('hf-read@pve!a', 61))), 1);
  });

  it('never keeps a lease inside the margin', () => {
    assert.equal(keptSeconds(Exit.succeed(cred('hf-read@pve!brief', 60))), 0);
    assert.equal(keptSeconds(Exit.succeed(cred('hf-read@pve!brief', 30))), 0);
  });

  it('never keeps a lease with no reported duration', () => {
    // ⛔ `lease_duration` absent reads as 0. Keeping a credential of unknown lifetime is the one
    //    thing this file must not do — not keeping is always safe.
    assert.equal(keptSeconds(Exit.succeed(cred('hf-read@pve!unknown', 0))), 0);
  });

  it('never keeps a failure', () => {
    assert.equal(keptSeconds(Exit.fail(new Error('vault sealed'))), 0);
  });
});

describe('lease cache under concurrency', () => {
  it('mints once for many concurrent callers, and serves the next from the cache', async () => {
    const mint = countingMint(() => cred('hf-read@pve!a', 3600));
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        const exits = yield* concurrently(20, Cache.get(leases, TB4));
        assert.equal(exits.filter(Exit.isSuccess).length, 20);
        // An equal but separately built key is the same entry.
        yield* Cache.get(leases, { ...TB4 });
      }),
    );
    assert.equal(mint.calls(), 1);
  });

  // ⛔ THE HAND-WRITTEN CACHE'S BUG LIVED HERE: a failed mint let every waiter claim at once.
  it('mints ONCE more after a failure, not once per waiter', async () => {
    const mint = countingMint((call) =>
      call === 1 ? new Error('vault sealed') : cred('hf-read@pve!b', 3600),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        const first = yield* concurrently(20, Cache.get(leases, TB4));
        assert.equal(first.filter(Exit.isFailure).length, 20, 'the waiters share the failure');
        const second = yield* concurrently(20, Cache.get(leases, TB4));
        assert.equal(second.filter(Exit.isSuccess).length, 20);
      }),
    );
    assert.equal(mint.calls(), 2);
  });

  it('shares an uncacheable lease with its waiters and mints again for the next caller', async () => {
    const mint = countingMint((call) => cred(`hf-read@pve!brief${String(call)}`, 30));
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        yield* concurrently(20, Cache.get(leases, TB4));
        yield* Cache.get(leases, TB4);
      }),
    );
    assert.equal(mint.calls(), 2);
  });

  it('does not serve one cluster the credential of another with the same mount and role', async () => {
    const mint = countingMint((call) => cred(`hf-read@pve!${String(call)}`, 3600));
    const [tb4, ops] = await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        return [yield* Cache.get(leases, TB4), yield* Cache.get(leases, OPS)] as const;
      }),
    );
    assert.notEqual(tb4.tokenId, ops.tokenId);
    assert.equal(mint.calls(), 2);
  });

  it('shares one lease across two members of the same cluster mount', async () => {
    const mint = countingMint((call) => cred(`hf-read@pve!${String(call)}`, 3600));
    const N2: LeaseKey = { mount: 'proxmox-tb4', role: 'read', scheme: 'pve' };
    const N3: LeaseKey = { mount: 'proxmox-tb4', role: 'read', scheme: 'pve' };
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        yield* Cache.get(leases, N2);
        yield* Cache.get(leases, N3);
      }),
    );
    assert.equal(mint.calls(), 1);
  });

  it('keeps read and provision apart', async () => {
    const mint = countingMint((call) => cred(`hf@pve!${String(call)}`, 3600));
    const PROVISION: LeaseKey = { ...TB4, role: 'provision' };
    const [read, provision] = await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        return [yield* Cache.get(leases, TB4), yield* Cache.get(leases, PROVISION)] as const;
      }),
    );
    assert.notEqual(read.tokenId, provision.tokenId);
  });
});
