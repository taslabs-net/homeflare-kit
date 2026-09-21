/**
 * NOTHING IS ADOPTED WITHOUT `--adopt` (decided 2026-09-21), for the nine batch-2 families, through
 * Alchemy's own plan and apply (fake-stack.ts). The object is put there by ANOTHER stack over the
 * same fake (`owner`) — the case the rule exists for: identical to this declaration, and still
 * not ours.
 *   · plan time: the adoption probe answers `Unowned` (ownership/probe.ts);
 *   · apply time: where the probe never ran — a prop still an Output — reconcile refuses before any
 *     write (ownership/adopt.ts).
 * adopt-recovery.test.ts pins the other side: our own interrupted create is still resumed.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import type { Seen } from './fake-bao.ts';
import { FAMILIES, type Family, upstream, withEstate } from './fake-families.ts';
import { writesOf } from './fake-stack.ts';

const NOT_OWNED = /Cannot adopt resource 'Z'.*not owned by this stack.*--adopt/s;
const TAKEOVER = /: already exists, and this stack holds no state for it.*Nothing was written/s;
const STILL_REFUSED = /Cannot adopt resource 'Z'.*--adopt/s;

/** `Z` names `a`, with its knob an Output until apply: the upstream AppRole is created with it. */
const pending = (row: Family, scoped?: boolean) =>
  Effect.gen(function* () {
    const up = yield* upstream('15m');
    const declared = row.declare('Z', 'a', up.tokenTtl);
    yield* scoped === undefined ? declared : declared.pipe(adopt(scoped));
  });

/** Writes other than the upstream AppRole's own create. */
const writesToA = (seen: readonly Seen[]) =>
  writesOf(seen).filter((line) => !line.endsWith('/upstream'));

for (const row of FAMILIES) {
  describe(`${row.family}: a live object another stack owns`, () => {
    it('identical to the declaration, still fails the plan; nothing is written', async () => {
      await withEstate(async (stack, estate, seen, owner) => {
        await owner.deploy(row.declare('X', 'a', '15m'));
        seen.length = 0;
        await assert.rejects(stack.deploy(row.declare('Z', 'a', '15m')), NOT_OWNED);
        assert.deepEqual(writesOf(seen), []);
        assert.ok(row.has(estate, 'a'));
      });
    });

    it('is adopted with --adopt, and with adopt(true) — identical, so nothing is written', async () => {
      for (const deploy of ['flag', 'scope'] as const) {
        await withEstate(async (stack, _estate, seen, owner) => {
          await owner.deploy(row.declare('X', 'a', '15m'));
          seen.length = 0;
          const body =
            deploy === 'flag'
              ? stack.deploy(row.declare('Z', 'a', '15m'), { adopt: true })
              : stack.deploy(row.declare('Z', 'a', '15m').pipe(adopt(true)));
          assert.deepEqual(await body, { Z: 'adopted' });
          assert.deepEqual(writesOf(seen), []);
        });
      }
    });

    it('with a prop still an Output, the plan cannot ask, so the apply refuses', async () => {
      await withEstate(async (stack, estate, seen, owner) => {
        await owner.deploy(row.declare('X', 'a', '15m'));
        seen.length = 0;
        await assert.rejects(stack.deploy(pending(row)), TAKEOVER);
        assert.deepEqual(writesToA(seen), []);
        assert.ok(row.has(estate, 'a'));
        // ★ The refused create forgot its `creating` row, so the next plan probes: still refused.
        await assert.rejects(stack.deploy(pending(row)), STILL_REFUSED);
        assert.deepEqual(writesToA(seen), []);
      });
    });

    it('with a prop still an Output, --adopt and adopt(true) take it over at apply', async () => {
      for (const deploy of ['flag', 'scope'] as const) {
        await withEstate(async (stack, _estate, _seen, owner) => {
          await owner.deploy(row.declare('X', 'a', '15m'));
          const planned =
            deploy === 'flag'
              ? await stack.deploy(pending(row), { adopt: true })
              : await stack.deploy(pending(row, true));
          assert.deepEqual(planned, { Upstream: 'create', Z: 'create' });
        });
      }
    });

    it('adopt(false) on the resource wins over --adopt, at apply as at plan', async () => {
      await withEstate(async (stack, _estate, _seen, owner) => {
        await owner.deploy(row.declare('X', 'a', '15m'));
        await assert.rejects(stack.deploy(pending(row, false), { adopt: true }), TAKEOVER);
      });
    });
  });
}
