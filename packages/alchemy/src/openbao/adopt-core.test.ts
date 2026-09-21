/**
 * The ownership rule for the five families fake-core.ts carries — Bao.Policy, Bao.CloudflareRole,
 * Bao.ProxmoxRole, Bao.Mount and Bao.AuthMethod — through Alchemy's own plan and apply: the same
 * claims adopt-families.test.ts and adopt-recovery.test.ts make for the other nine.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import { BaoAuthRole } from './auth-role.ts';
import { crashAfterWrite } from './fake-bao.ts';
import { CORE, type CoreRow, withCore } from './fake-core.ts';
import { writesOf } from './fake-stack.ts';
import { BaoMount } from './mount.ts';

const NOT_OWNED = /Cannot adopt resource 'Z'.*not owned by this stack.*--adopt/s;
const TAKEOVER = /: already exists, and this stack holds no state for it.*Nothing was written/s;

/** `Z`, with its knob an Output until apply: an upstream AppRole's `tokenTtl`, created with it. */
const pending = (row: CoreRow) =>
  Effect.gen(function* () {
    const up = yield* BaoAuthRole('Upstream', {
      name: 'upstream',
      secretIdTtl: '24h',
      tokenMaxTtl: '1h',
      tokenPolicies: ['default'],
      tokenTtl: '15m',
    });
    yield* row.declare('Z', up.tokenTtl);
  });

for (const row of CORE) {
  describe(`${row.family}: ownership`, () => {
    it('a live object another stack owns, identical, fails the plan; nothing is written', async () => {
      await withCore(async (stack, estate, seen, owner) => {
        await owner.deploy(row.declare('X', '15m'));
        seen.length = 0;
        await assert.rejects(stack.deploy(row.declare('Z', '15m')), NOT_OWNED);
        assert.deepEqual(writesOf(seen), []);
        assert.ok(row.has(estate));
        assert.deepEqual(await stack.deploy(row.declare('Z', '15m'), { adopt: true }), {
          Z: 'adopted',
        });
        assert.deepEqual(writesOf(seen), []);
      });
    });

    it('with a prop still an Output, the apply refuses it; the next plan refuses too', async () => {
      await withCore(async (stack, _estate, seen, owner) => {
        await owner.deploy(row.declare('X', '15m'));
        seen.length = 0;
        await assert.rejects(stack.deploy(pending(row)), TAKEOVER);
        // ★ The refused create forgot its `creating` row, so the next plan probes: still refused.
        await assert.rejects(stack.deploy(pending(row)), NOT_OWNED);
        assert.deepEqual(
          writesOf(seen).filter((line) => !line.endsWith('/upstream')),
          [],
        );
      });
    });

    it('with a prop still an Output, --adopt takes it over at apply', async () => {
      await withCore(async (stack, _estate, _seen, owner) => {
        await owner.deploy(row.declare('X', '15m'));
        assert.deepEqual(await stack.deploy(pending(row), { adopt: true }), {
          Upstream: 'create',
          Z: 'create',
        });
      });
    });

    it('an interrupted create is resumed without --adopt, and nothing is rewritten', async () => {
      const fault = crashAfterWrite();
      await withCore(async (stack, estate, seen) => {
        // ★ Bao.Policy reads nothing back after its write, so the crash is the write's own reply.
        fault.crashNext(row.family === 'Bao.Policy' ? 'write' : 'read-back');
        await assert.rejects(stack.deploy(row.declare('X', '15m')), /injected/);
        assert.ok(row.has(estate));
        seen.length = 0;
        assert.deepEqual(await stack.deploy(row.declare('X', '15m')), { X: 'create' });
        assert.deepEqual(writesOf(seen), []);
      }, fault.wrap);
    });
  });
}

describe('Bao.Mount: remountFrom on a create', () => {
  const moved = BaoMount('Kv', { path: 'kv-moved', remountFrom: 'kv', type: 'kv' });
  const SOURCE = /Bao\.Mount kv \(the remountFrom source\): already exists/;

  it('moving a live mount this stack holds no state for is refused before the move', async () => {
    await withCore(async (stack, estate, seen, owner) => {
      await owner.deploy(BaoMount('Src', { path: 'kv', type: 'kv' }));
      seen.length = 0;
      // ★ The probe reads only the target, which is free: the plan says create.
      await assert.rejects(stack.deploy(moved), SOURCE);
      assert.deepEqual(writesOf(seen), []);
      assert.deepEqual([...estate.mounts.table.keys()], ['kv/']);
      assert.deepEqual(await stack.deploy(moved, { adopt: true }), { Kv: 'create' });
      assert.deepEqual([...estate.mounts.table.keys()], ['kv-moved/']);
    });
  });
});

describe('Bao.Mount: a create interrupted between its enable and its tune', () => {
  it('is not proven ours — the mount is not what was declared — so it resumes with --adopt', async () => {
    const fault = crashAfterWrite();
    const kv = BaoMount('Kv', { defaultLeaseTtl: '15m', path: 'kv', type: 'kv' });
    await withCore(async (stack, estate) => {
      fault.crashNext('write');
      await assert.rejects(stack.deploy(kv), /injected/);
      assert.ok(estate.mounts.table.has('kv/'));
      await assert.rejects(stack.deploy(kv), /Cannot resume creating resource 'Kv'.*--adopt/s);
      assert.deepEqual(await stack.deploy(kv, { adopt: true }), { Kv: 'create' });
      assert.deepEqual(await stack.deploy(kv), { Kv: 'noop' });
    }, fault.wrap);
  });
});
