/**
 * The swap the plan-time guard cannot see: a NEW declaration of a name that is live. 🔴 MEASURED
 * 2026-09-21 through Alchemy's own plan and apply (fake-stack.ts). With no state row, the engine asks
 * `read`, which finds the object and answers plain attributes, so Alchemy silently adopts it
 * (alchemy@2.0.0-beta.79 Plan.ts, the adoption probe; AdoptPolicy.ts). Nothing moved, so
 * `judgeMove` never runs. Under `RemovalPolicy.destroy()` the old owner's delete then runs in
 * Apply's phase 2, after the adoption has written, and removes the object the new declaration now
 * claims. The deploy is green.
 *
 * ★ These pin that, and the two ways round it REPLACE.md gives: `renamedFrom` for a logical id that
 *   changes, and a second deploy for a name another resource is leaving. If one of the hazards stops
 *   reproducing, the engine changed: re-read REPLACE.md before relaxing it.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renamedFrom } from 'alchemy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { FAMILIES, rowOf, withEstate } from './fake-families.ts';
import { writesOf } from './fake-stack.ts';

const { destroy } = RemovalPolicy;

/** No delete endpoint (jwt-config.ts), and a delete the provider refuses (mfa-enforcement.ts). */
const KEEPS = new Set(['Bao.JwtAuthConfig', 'Bao.MfaLoginEnforcement']);
const REFUSES_DELETE = /Bao\.MfaLoginEnforcement/;

describe('a logical id changed without renamedFrom, under destroy', () => {
  for (const row of FAMILIES) {
    it(`${row.family}: the orphan delete removes what the new id just adopted`, async () => {
      await withEstate(async (stack, estate) => {
        await stack.deploy(row.declare('X', 'a', '15m', destroy));
        const again = stack.deploy(row.declare('Z', 'a', '15m', destroy));
        if (row.family === 'Bao.MfaLoginEnforcement') await assert.rejects(again, REFUSES_DELETE);
        else assert.deepEqual(await again, { X: 'delete', Z: 'adopted' });
        assert.equal(row.has(estate, 'a'), KEEPS.has(row.family));
      });
    });
  }
});

describe('the ways round it', () => {
  const row = rowOf('Bao.AuthRole');

  it('renamedFrom migrates the state row instead: an update that deletes nothing', async () => {
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(row.declare('X', 'a', '15m', destroy));
      seen.length = 0;
      const moved = row.declare('Z', 'a', '15m', destroy).pipe(renamedFrom('X'));
      assert.deepEqual(await stack.deploy(moved), { Z: 'update' });
      assert.deepEqual(writesOf(seen), []);
      assert.ok(row.has(estate, 'a'));
    });
  });

  it('a name another resource moves off is lost when taken in the same deploy', async () => {
    await withEstate(async (stack, estate) => {
      await stack.deploy(row.declare('X', 'a', '15m', destroy));
      const both = Effect.gen(function* () {
        yield* row.declare('X', 'b', '15m', destroy);
        yield* row.declare('Z', 'a', '30m', destroy);
      });
      assert.deepEqual(await stack.deploy(both), { X: 'replace', Z: 'adopted' });
      assert.ok(row.has(estate, 'b') && !row.has(estate, 'a'));
    });
  });

  it('and survives when taken in the deploy after the move', async () => {
    await withEstate(async (stack, estate) => {
      await stack.deploy(row.declare('X', 'a', '15m', destroy));
      await stack.deploy(row.declare('X', 'b', '15m', destroy));
      const both = Effect.gen(function* () {
        yield* row.declare('X', 'b', '15m', destroy);
        yield* row.declare('Z', 'a', '30m', destroy);
      });
      assert.deepEqual(await stack.deploy(both), { X: 'noop', Z: 'create' });
      assert.ok(row.has(estate, 'a') && row.has(estate, 'b'));
    });
  });
});
