/**
 * The in-flight cap on OpenBao exchanges (`BaoGate` in bao-http.ts), counted where the listener that
 * died on 2026-09-14 counted it: on the server. The fake holds every request for a few milliseconds
 * and records the most it ever held at once.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as Semaphore from 'effect/Semaphore';
import { BaoGate, MAX_IN_FLIGHT, baoRead } from './bao-http.ts';
import { type Reply, run, runFailure, withFake } from './fake-bao.ts';

/** A fake that holds each request `holdMs`, answering `reply`, and remembers its peak overlap. */
const holding = (reply: (path: string) => Reply, holdMs = 15) => {
  const counts = { inFlight: 0, peak: 0 };
  const answer = async (seen: { path: string }) => {
    counts.inFlight += 1;
    counts.peak = Math.max(counts.peak, counts.inFlight);
    await Bun.sleep(holdMs);
    counts.inFlight -= 1;
    return reply(seen.path);
  };
  return { answer, counts };
};

const OK: Reply = { json: { data: {} }, status: 200 };

const burst = (address: string, calls: number, gate?: Semaphore.Semaphore) =>
  Promise.all(
    Array.from({ length: calls }, (_, index) => {
      const read = baoRead(`kv/burst/${String(index)}`);
      return run(
        { BAO_ADDR: address },
        gate === undefined ? read : read.pipe(Effect.provideService(BaoGate, gate)),
      );
    }),
  );

describe('BaoGate', () => {
  it('never lets more than the gate through at once, and still answers every call', async () => {
    const fake = holding(() => OK);
    await withFake(fake.answer, async (bao) => {
      const results = await burst(bao.address, 40, Semaphore.makeUnsafe(4));
      assert.equal(results.length, 40);
      assert.equal(bao.seen.length, 40);
      // ★ EQUAL, NOT AT-MOST: 4 proves the calls really overlapped, so the cap was what held them.
      assert.equal(fake.counts.peak, 4);
    });
  });

  it('caps an unprovided burst at MAX_IN_FLIGHT — the gate every provider shares', async () => {
    const fake = holding(() => OK);
    await withFake(fake.answer, async (bao) => {
      await burst(bao.address, MAX_IN_FLIGHT * 3);
      assert.equal(fake.counts.peak, MAX_IN_FLIGHT);
    });
  });

  // ★ THE SENSITIVITY CHECK: the same burst through a wide gate overlaps far past 4, so the tests
  //   above would fail if the permit were dropped from baoCall.
  it('lets the burst overlap when the gate is wide, so the cap above is doing the holding', async () => {
    const fake = holding(() => OK);
    await withFake(fake.answer, async (bao) => {
      await burst(bao.address, 40, Semaphore.makeUnsafe(1000));
      assert.ok(fake.counts.peak > 4, `peak was ${String(fake.counts.peak)}`);
    });
  });

  it('gives a permit back when OpenBao refuses the call', async () => {
    const denied: Reply = { json: { errors: ['permission denied'] }, status: 403 };
    const fake = holding((path) => (path.includes('/refused/') ? denied : OK), 2);
    await withFake(fake.answer, async (bao) => {
      const gate = Semaphore.makeUnsafe(2);
      const env = { BAO_ADDR: bao.address };
      const gated = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(BaoGate, gate));
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          runFailure(env, gated(baoRead(`kv/refused/${String(index)}`))),
        ),
      );
      // ⛔ A LEAKED PERMIT HANGS HERE rather than failing, so the race turns a hang into a failure.
      const after = run(env, gated(baoRead('kv/after')));
      const hung = Bun.sleep(2000).then(() => 'hung' as const);
      assert.notEqual(await Promise.race([after, hung]), 'hung');
    });
  });
});
