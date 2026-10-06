/**
 * Crash recovery survives the ownership rule: a deploy that dies after its write and before its
 * commit leaves a `creating` (or `replacing`) row and a live object, and the next deploy must
 * finish it WITHOUT `--adopt` — the object is ours (ownership/probe.ts, ownership/resume.ts).
 * The crash is injected: the first read after a write answers 500, which is exactly a reconcile
 * whose write landed and whose read-back, and so its commit, never did.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { type Seen, crashAfterWrite } from './fake-bao.ts';
import type { Estate } from './fake-engines-roles.ts';
import { FAMILIES, withEstate } from './fake-families.ts';
import { type FakeStack, writesOf } from './fake-stack.ts';

const RESUME_REFUSED = /Cannot resume creating resource 'X'.*--adopt/s;

type Run = (stack: FakeStack, estate: Estate, seen: Seen[], owner: FakeStack) => Promise<void>;
const withCrashes = (body: (crashNext: () => void) => Run) => {
  const fault = crashAfterWrite();
  return withEstate(body(fault.crashNext), fault.wrap);
};

for (const row of FAMILIES) {
  describe(`${row.family}: an interrupted create`, () => {
    it('is resumed without --adopt when the object is what it wrote; nothing is rewritten', async () => {
      await withCrashes((crashNext) => async (stack, estate, seen) => {
        crashNext();
        await assert.rejects(stack.deploy(row.declare('X', 'a', '15m')), /injected/);
        assert.ok(row.has(estate, 'a'));
        seen.length = 0;
        assert.deepEqual(await stack.deploy(row.declare('X', 'a', '15m')), { X: 'create' });
        assert.deepEqual(writesOf(seen), []);
        assert.deepEqual(await stack.deploy(row.declare('X', 'a', '15m')), { X: 'noop' });
      });
    });

    it('is refused when the object has since changed, and resumed with --adopt', async () => {
      await withCrashes((crashNext) => async (stack, _estate, _seen, owner) => {
        crashNext();
        await assert.rejects(stack.deploy(row.declare('X', 'a', '15m')), /injected/);
        // ★ Someone else rewrites it in between: another stack, taking it over with --adopt.
        await owner.deploy(row.declare('O', 'a', '30m'), { adopt: true });
        await assert.rejects(stack.deploy(row.declare('X', 'a', '15m')), RESUME_REFUSED);
        const resumed = await stack.deploy(row.declare('X', 'a', '15m'), { adopt: true });
        assert.deepEqual(resumed, { X: 'create' });
      });
    });
  });
}

/** Bao.MfaTotpMethod never renames (mfa-totp.ts), so it has no replace to interrupt. */
for (const row of FAMILIES.filter((each) => each.family !== 'Bao.MfaTotpMethod')) {
  describe(`${row.family}: an interrupted replace`, () => {
    it('is resumed without --adopt: the new generation it wrote is not taken over', async () => {
      await withCrashes((crashNext) => async (stack, estate) => {
        const { retain } = RemovalPolicy;
        await stack.deploy(row.declare('X', 'a', '15m', retain));
        crashNext();
        await assert.rejects(stack.deploy(row.declare('X', 'b', '15m', retain)), /injected/);
        assert.ok(row.has(estate, 'b'));
        assert.deepEqual(await stack.deploy(row.declare('X', 'b', '15m', retain)), {
          X: 'replace',
        });
        assert.deepEqual(await stack.deploy(row.declare('X', 'b', '15m', retain)), { X: 'noop' });
      });
    });
  });
}

/**
 * 🔴 A DESTROY AFTER A CRASHED CREATE MUST STILL DELETE (red team, kit PR 359, 2026-10-06). The
 * engine's deletion-recovery read (Apply.ts, a row with no attributes) shares alchemy beta.81's
 * `provider.read` span with the create-time deferred-adoption read. Answering `Unowned` to both
 * made the engine skip `provider.delete` and erase the row: a live object nothing tracked.
 */
/** Bao.JwtAuthConfig's delete writes nothing and Bao.MfaLoginEnforcement's refuses: no object goes. */
const DELETES_NOTHING = ['Bao.JwtAuthConfig', 'Bao.MfaLoginEnforcement'];
for (const row of FAMILIES.filter((each) => !DELETES_NOTHING.includes(each.family))) {
  describe(`${row.family}: a destroy after an interrupted create`, () => {
    it('deletes the object the crashed create wrote', async () => {
      await withCrashes((crashNext) => async (stack, estate) => {
        crashNext();
        const destroy = RemovalPolicy.destroy;
        await assert.rejects(stack.deploy(row.declare('X', 'a', '15m', destroy)), /injected/);
        assert.ok(row.has(estate, 'a'));
        const declared = row.declare('X', 'a', '15m', destroy);
        assert.deepEqual(await stack.destroy(declared), { X: 'delete' });
        assert.ok(!row.has(estate, 'a'), 'the destroy left the object it was asked to delete');
      });
    });
  });
}
