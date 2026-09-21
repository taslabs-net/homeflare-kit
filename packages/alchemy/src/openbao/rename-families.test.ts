/**
 * The nine batch-2 families, renamed through Alchemy's own plan and apply (fake-stack.ts), one row
 * each (fake-families.ts). 🔴 Before rename-identity.ts, MEASURED 2026-09-21 against these fakes:
 *   · a swap under destroy was a GREEN deploy that deleted both objects, for Bao.AuthRole,
 *     Bao.PkiRole, Bao.JwtRole, Bao.KubernetesRole, Bao.SshRole and Bao.Plugin, and a shift left
 *     only `c`. Bao.JwtAuthConfig wrote each config over the other (it has no delete), and
 *     Bao.MfaLoginEnforcement did the same, then stopped on its two refused deletes;
 *   · a rename landing with another pending Output planned `update` for all nine and left the old
 *     object live and unrecorded; for Bao.MfaTotpMethod that wrote a second method;
 *   · with the identity itself pending, all nine wrote the new object and kept the old.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Output from 'alchemy/Output';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { type Estate, fakeEstate } from './fake-engines-roles.ts';
import { FAMILIES, type Family, familyProviders, pairOf, upstream } from './fake-families.ts';
import { type FakeStack, type StackBody, withFakeStack, writesOf } from './fake-stack.ts';
import type { Seen } from './fake-bao.ts';
import { BaoAuthRole } from './auth-role.ts';
import { BaoKubernetesRole } from './kubernetes-role.ts';
import { foldName } from './rename-identity.ts';

const OCCUPIED = /would land on an object that already exists/;
/** Bao.MfaTotpMethod never replaces: every rename is refused (mfa-totp.ts). */
const STRANDS = /would strand every enrolled secret/;
const isTotp = (row: Family) => row.family === 'Bao.MfaTotpMethod';

const withEstate = (body: (stack: FakeStack, estate: Estate, seen: Seen[]) => Promise<void>) => {
  const estate = fakeEstate();
  return withFakeStack(familyProviders, estate, (stack, bao) => body(stack, estate, bao.seen));
};

const snapshot = (estate: Estate) => [
  new Map(estate.roles.live),
  new Map(estate.plugins.live),
  new Map(estate.totp.live),
];

/** Another prop of the row pending: the upstream's `tokenTtl` changes in the same deploy. */
const pendingKnob = (row: Family) => (ttl: string, name: string) =>
  Effect.gen(function* () {
    const up = yield* upstream(ttl);
    yield* row.declare('Subject', name, up.tokenTtl);
  });

/** The identity itself pending: `r-15m`, then `r-30m`. */
const pendingName = (row: Family) => (ttl: string) =>
  Effect.gen(function* () {
    const up = yield* upstream(ttl);
    yield* row.declare('Subject', Output.interpolate`r-${up.tokenTtl}`, '15m');
  });

for (const row of FAMILIES) {
  describe(`${row.family}: a rename`, () => {
    const pair = pairOf(row);
    const refusal = isTotp(row) ? STRANDS : OCCUPIED;

    it('onto a name its sibling holds (a swap, under destroy) writes and deletes nothing', async () => {
      await withEstate(async (stack, estate, seen) => {
        await stack.deploy(pair('a', 'b'));
        const before = snapshot(estate);
        seen.length = 0;
        await assert.rejects(stack.deploy(pair('b', 'a')), refusal);
        assert.deepEqual(writesOf(seen), []);
        assert.deepEqual(snapshot(estate), before);
      });
    });

    it('onto a name still held while that one moves on (a shift) writes nothing', async () => {
      await withEstate(async (stack, estate, seen) => {
        await stack.deploy(pair('a', 'b'));
        seen.length = 0;
        await assert.rejects(stack.deploy(pair('b', 'c')), refusal);
        assert.deepEqual(writesOf(seen), []);
        assert.ok(row.has(estate, 'a') && row.has(estate, 'b') && !row.has(estate, 'c'));
      });
    });

    it('that lands with another prop pending is judged at plan, not planned as update', async () => {
      await withEstate(async (stack, estate, seen) => {
        const body = pendingKnob(row);
        await stack.deploy(body('15m', 'a'));
        if (isTotp(row)) {
          seen.length = 0;
          await assert.rejects(stack.deploy(body('30m', 'b')), STRANDS);
          // ★ At plan: not even the upstream's update is applied.
          assert.deepEqual(writesOf(seen), []);
          return;
        }
        assert.deepEqual(await stack.deploy(body('30m', 'b')), {
          Subject: 'replace',
          Upstream: 'update',
        });
        // ★ The default retain keeps the old generation; the new one is written.
        assert.ok(row.has(estate, 'a') && row.has(estate, 'b'));
      });
    });

    it('to a name not known until apply is refused before any write, then judged', async () => {
      await withEstate(async (stack, estate) => {
        const body = pendingName(row);
        await stack.deploy(body('15m'));
        const moved = isTotp(row) ? /renaming from `r-15m`/ : /identity moved from \S*r-15m\S* to/;
        await assert.rejects(stack.deploy(body('30m')), moved);
        assert.ok(!row.has(estate, 'r-30m'));
        if (isTotp(row)) {
          await assert.rejects(stack.deploy(body('30m')), STRANDS);
          return;
        }
        assert.deepEqual(await stack.deploy(body('30m')), { Subject: 'replace', Upstream: 'noop' });
        assert.ok(row.has(estate, 'r-30m'));
      });
    });
  });
}

describe('a change of case the server folds away is not a rename', () => {
  it('foldName lowercases the name segment only; a mount path keeps its case', () => {
    assert.equal(foldName('Host-Cert'), 'host-cert');
    assert.equal(foldName('auth/K8s/role/App'), 'auth/K8s/role/app');
  });

  it('Bao.AuthRole: `Host-A` after `host-a` under destroy is a noop, nothing deleted', async () => {
    const role = (name: string): StackBody =>
      Effect.asVoid(
        BaoAuthRole('Role', {
          name,
          secretIdTtl: '24h',
          tokenMaxTtl: '1h',
          tokenPolicies: ['default'],
          tokenTtl: '15m',
        }).pipe(RemovalPolicy.destroy()),
      );
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(role('host-a'));
      seen.length = 0;
      assert.deepEqual(await stack.deploy(role('Host-A')), { Role: 'noop' });
      assert.deepEqual(writesOf(seen), []);
      assert.ok(estate.roles.live.has('auth/approle/role/host-a'));
    });
  });

  it('Bao.KubernetesRole: `App` after `app` is the same role, refused only for its case', async () => {
    const role = (name: string): StackBody =>
      Effect.asVoid(
        BaoKubernetesRole('Role', {
          aliasNameSource: 'serviceaccount_uid',
          boundServiceAccountNames: ['app'],
          boundServiceAccountNamespaces: ['apps'],
          name,
          tokenPolicies: ['app'],
        }).pipe(RemovalPolicy.destroy()),
      );
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(role('app'));
      seen.length = 0;
      await assert.rejects(stack.deploy(role('App')), /must be lower case/);
      assert.deepEqual(writesOf(seen), []);
      assert.ok(estate.roles.live.has('auth/kubernetes/role/app'));
    });
  });
});
