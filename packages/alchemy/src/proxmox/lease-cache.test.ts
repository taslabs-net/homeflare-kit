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
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  type BaoEnvironment,
  type PveCredential,
  type PveTarget,
  mintTier,
} from './credentials.ts';
import {
  type LeaseKey,
  keyOf,
  makeLeases,
  mintForKey,
  targetForKey,
  timeToLive,
} from './lease-cache.ts';

/** ⚠️ Same minimal Bun typing as credentials.test.ts — this package's tsconfig has no Bun types. */
type ServeOptions = { fetch(request: Request): Promise<Response>; hostname: string; port: number };
const { Bun } = globalThis as unknown as {
  Bun: { serve(options: ServeOptions): { url: URL; stop(closeActive: boolean): void } };
};

const C1: LeaseKey = {
  mount: 'proxmox-c1',
  scheme: 'pve',
  tier: 'read',
};
/** ⚠️ Same role as C1, DIFFERENT mount — the collision the key has to survive. */
const C2: LeaseKey = { ...C1, mount: 'proxmox-c2' };

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

describe('K-T1: keyOf resolves an overridden tier into the cache key (I1)', () => {
  // ⛔ The one line the PR exists for (`tier: mintTier(target, role)` in `keyOf`) had no direct
  //   test: revert it to `tier: role` and the rest of the suite still passes, because
  //   `targetForKey`'s tests prove only the reconstruction half and `mintTier`'s tests prove only
  //   the resolution function, never the composition a real `leased()` call depends on.
  it('a plain PveTarget with no override keys on the bare role', () => {
    const target: PveTarget = { members: [], mount: 'proxmox-tb4', scheme: 'pve' };
    assert.equal(keyOf(target, 'read').tier, 'read');
  });

  it('a PveTarget.roles override reaches the cache key, not just a direct mint', () => {
    const target: PveTarget = {
      members: [],
      mount: 'proxmox-tb4',
      roles: { read: 'talos-provision' },
      scheme: 'pve',
    };
    assert.equal(keyOf(target, 'read').tier, 'talos-provision');
    // The unmentioned role still falls back to itself on the same target.
    assert.equal(keyOf(target, 'provision').tier, 'provision');
  });

  it('a PbsTarget key never carries an override — the type has no roles field', () => {
    const pbs = { api: 'https://pbs.invalid/api2/json', mount: 'pbs-c1', scheme: 'pbs' as const };
    assert.equal(keyOf(pbs, 'read').tier, 'read');
  });
});

describe('K-T1/M3: targetForKey round-trips the resolved tier back through mintTier', () => {
  // ⛔ Since M3 dropped `role` from `LeaseKey`, `targetForKey` always mints a pve reconstruction
  //   with the fixed role `'read'` — the caller's ORIGINAL role is irrelevant here, only `tier`
  //   (already resolved by `keyOf`) has to round-trip.
  it('a plain tier reconstructs to itself', () => {
    const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'read' };
    assert.equal(mintTier(targetForKey(key), 'read'), 'read');
  });

  it('an overridden tier reconstructs to the SAME tier, not the bare role', () => {
    // ⛔ This is the exact reconstruction the cache-miss path depends on: `keyOf` resolved
    //   `talos-provision` from the caller's real target once; `targetForKey` never sees that
    //   target again, only this key, so it has to be able to rebuild the same answer from `tier`
    //   alone.
    const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'talos-provision' };
    assert.equal(mintTier(targetForKey(key), 'read'), 'talos-provision');
  });

  it('a pbs key never carries an override through', () => {
    const key: LeaseKey = { mount: 'pbs-c1', scheme: 'pbs', tier: 'provision' };
    assert.equal(mintTier(targetForKey(key), 'provision'), 'provision');
  });
});

/**
 * ⚠️ EXERCISES `mintForKey` ITSELF, NOT A HAND-REPRODUCTION OF ITS CHOICES (second red-team pass
 *   on K-T1). The `targetForKey` tests above call `mintTier(targetForKey(key), 'read')` — passing
 *   `'read'` as a LITERAL that happens to match `mintForKey`'s own hardcoded pve role, so those
 *   tests would keep passing even if `mintForKey` minted with a different role than it reconstructs
 *   the target for. A fake OpenBao server pins the ACTUAL request path `mintForKey` sends.
 */
describe("K-T1/M3: mintForKey requests the key's own tier, not a re-derived role", () => {
  const withFakeBao = async (body: (address: string, seen: string[]) => Promise<void>) => {
    const seen: string[] = [];
    const server = Bun.serve({
      fetch: async (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return Response.json({ data: { secret: 'x', token_id: 'hf-read@pve!hf-read-1' } });
      },
      hostname: '127.0.0.1',
      port: 0,
    });
    try {
      await body(server.url.origin, seen);
    } finally {
      server.stop(true);
    }
  };
  const env = (address: string): BaoEnvironment => ({ BAO_ADDR: address, BAO_TOKEN: 't' });
  const run = (key: LeaseKey, address: string) =>
    Effect.runPromise(mintForKey(key, env(address)).pipe(Effect.provide(FetchHttpClient.layer)));

  it('a plain pve key mints /creds/<tier> with the bare role tier', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'read' };
      await run(key, address);
      assert.equal(seen[0], '/v1/proxmox-tb4/creds/read');
    });
  });

  it('an overridden pve key mints the OVERRIDDEN tier, not a bare role', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'talos-provision' };
      await run(key, address);
      assert.equal(seen[0], '/v1/proxmox-tb4/creds/talos-provision');
    });
  });

  it('a pbs key mints its own tier directly', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'pbs-c1', scheme: 'pbs', tier: 'provision' };
      await run(key, address);
      assert.equal(seen[0], '/v1/pbs-c1/creds/provision');
    });
  });
});

describe('lease cache under concurrency', () => {
  it('mints once for many concurrent callers, and serves the next from the cache', async () => {
    const mint = countingMint(() => cred('hf-read@pve!a', 3600));
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        const exits = yield* concurrently(20, Cache.get(leases, C1));
        assert.equal(exits.filter(Exit.isSuccess).length, 20);
        // An equal but separately built key is the same entry.
        yield* Cache.get(leases, { ...C1 });
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
        const first = yield* concurrently(20, Cache.get(leases, C1));
        assert.equal(first.filter(Exit.isFailure).length, 20, 'the waiters share the failure');
        const second = yield* concurrently(20, Cache.get(leases, C1));
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
        yield* concurrently(20, Cache.get(leases, C1));
        yield* Cache.get(leases, C1);
      }),
    );
    assert.equal(mint.calls(), 2);
  });

  it('does not serve one cluster the credential of another with the same tier', async () => {
    const mint = countingMint((call) => cred(`hf-read@pve!${String(call)}`, 3600));
    const [c1, c2] = await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        return [yield* Cache.get(leases, C1), yield* Cache.get(leases, C2)] as const;
      }),
    );
    assert.notEqual(c1.tokenId, c2.tokenId);
    assert.equal(mint.calls(), 2);
  });

  it('shares one lease across two members of the same cluster mount', async () => {
    const mint = countingMint((call) => cred(`hf-read@pve!${String(call)}`, 3600));
    const NODE_B: LeaseKey = { mount: 'proxmox-c1', scheme: 'pve', tier: 'read' };
    const NODE_C: LeaseKey = { mount: 'proxmox-c1', scheme: 'pve', tier: 'read' };
    await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        yield* Cache.get(leases, NODE_B);
        yield* Cache.get(leases, NODE_C);
      }),
    );
    assert.equal(mint.calls(), 1);
  });

  it('keeps read and provision apart', async () => {
    const mint = countingMint((call) => cred(`hf@pve!${String(call)}`, 3600));
    const PROVISION: LeaseKey = { ...C1, tier: 'provision' };
    const [read, provision] = await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        return [yield* Cache.get(leases, C1), yield* Cache.get(leases, PROVISION)] as const;
      }),
    );
    assert.notEqual(read.tokenId, provision.tokenId);
  });

  // ⛔ K-T1's own reason `tier` joined the key: two consumers on the SAME mount/scheme but
  //   DIFFERENT `PveTarget.roles` overrides would otherwise collide into one cache entry and hand
  //   each other's credential to the wrong caller. M3 dropped `role` from the key entirely (it
  //   was always redundant with `tier`), which this test still exercises unchanged.
  it('keeps two different tier overrides of the same mount/scheme apart', async () => {
    const mint = countingMint((call) => cred(`hf@pve!${String(call)}`, 3600));
    const DEFAULT_READ: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'read' };
    const OVERRIDDEN_READ: LeaseKey = { ...DEFAULT_READ, tier: 'talos-provision' };
    const [plain, overridden] = await Effect.runPromise(
      Effect.gen(function* () {
        const leases = yield* makeLeases(mint.mintFor);
        return [
          yield* Cache.get(leases, DEFAULT_READ),
          yield* Cache.get(leases, OVERRIDDEN_READ),
        ] as const;
      }),
    );
    assert.notEqual(plain.tokenId, overridden.tokenId);
    assert.equal(mint.calls(), 2);
  });
});
