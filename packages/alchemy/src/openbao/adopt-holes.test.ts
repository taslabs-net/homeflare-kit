/**
 * A deploy killed BEFORE a create's claim ran leaves a `creating` (or `replacing`) row that proves
 * nothing: its create never asked whose object sat at its identity. Found by the red team on
 * 2026-09-21, through Alchemy's own plan and apply, before ownership/whole.ts and the proof in
 * ownership/resume.ts:
 *   · an Output IDENTITY — every role family read an empty name, found nothing, "resumed" the create
 *     and wrote over another owner's object;
 *   · an Output KNOB — Bao.Mount and Bao.AuthMethod read the hole as "not managed", adopted another
 *     owner's mount in the recovery read and tuned it;
 *   · a REPLACE killed before its write — the next deploy wrote over whatever another owner had put
 *     at the new identity since.
 * Each is now refused, writing nothing; `--adopt` resumes it, as Alchemy offers for a create.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { BaoAuthRole } from './auth-role.ts';
import { type Seen, refuseWriteOnce } from './fake-bao.ts';
import { CORE, type CoreRow, withCore } from './fake-core.ts';
import { FAMILIES, type Family, upstream, withEstate } from './fake-families.ts';
import { writesOf } from './fake-stack.ts';
import { BaoMount } from './mount.ts';
import { BaoPkiRole } from './pki-role.ts';

const REFUSED =
  /Cannot resume creating resource 'Z'|: already exists, and this stack holds no state/s;
const RESUME_REFUSED = /already exists, and this stack holds no state.*Deploy with --adopt/s;

/** Writes other than the upstream's. */
const writesBut = (seen: readonly Seen[], upstreamPath: string) =>
  writesOf(seen).filter((line) => !line.endsWith(upstreamPath));

/**
 * `Z`'s NAME is an Output: an upstream named `a` hands it over. An AppRole, or — for Bao.AuthRole,
 * whose own `a` that would be — a PKI role.
 */
const namedByUpstream = (row: Family) => {
  const approle = row.family !== 'Bao.AuthRole';
  const path = approle ? '/auth/approle/role/a' : '/pki/roles/a';
  const body = Effect.gen(function* () {
    const up = approle
      ? yield* BaoAuthRole('Upstream', {
          name: 'a',
          secretIdTtl: '24h',
          tokenMaxTtl: '1h',
          tokenPolicies: ['default'],
          tokenTtl: '15m',
        })
      : yield* BaoPkiRole('Upstream', {
          allowedDomains: ['x.test'],
          maxTtl: '1h',
          name: 'a',
          ttl: '30m',
        });
    yield* row.declare('Z', up.name, '15m');
  });
  return { body, path };
};

for (const row of FAMILIES) {
  describe(`${row.family}: a create killed before its claim, its name an Output`, () => {
    it('never writes over the object another stack owns; --adopt takes it over', async () => {
      const { body, path } = namedByUpstream(row);
      const fault = refuseWriteOnce(path);
      await withEstate(async (stack, _estate, seen, owner) => {
        await owner.deploy(row.declare('X', 'a', '30m'));
        await assert.rejects(stack.deploy(body), /injected/);
        seen.length = 0;
        await assert.rejects(stack.deploy(body), REFUSED);
        assert.deepEqual(writesBut(seen, path), []);
        await stack.deploy(body, { adopt: true });
      }, fault);
    });
  });

  describe(`${row.family}: a create killed before its claim, a knob an Output`, () => {
    it('never adopts the object another stack owns', async () => {
      const fault = refuseWriteOnce('/upstream');
      const body = Effect.gen(function* () {
        yield* row.declare('Z', 'a', (yield* upstream('15m')).tokenTtl);
      });
      await withEstate(async (stack, _estate, seen, owner) => {
        await owner.deploy(row.declare('X', 'a', '30m'));
        await assert.rejects(stack.deploy(body), /injected/);
        seen.length = 0;
        await assert.rejects(stack.deploy(body), REFUSED);
        assert.deepEqual(writesBut(seen, '/upstream'), []);
      }, fault);
    });
  });
}

/** `Z` at the row's fixed identity, its knob an upstream AppRole's `tokenTtl`. */
const pendingCore = (row: CoreRow) =>
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
  describe(`${row.family}: a create killed before its claim, a knob an Output`, () => {
    it('never adopts — or tunes — the object another stack owns; --adopt takes it over', async () => {
      const fault = refuseWriteOnce('/upstream');
      await withCore(async (stack, _estate, seen, owner) => {
        await owner.deploy(row.declare('X', '30m'));
        await assert.rejects(stack.deploy(pendingCore(row)), /injected/);
        seen.length = 0;
        await assert.rejects(stack.deploy(pendingCore(row)), REFUSED);
        assert.deepEqual(writesBut(seen, '/upstream'), []);
        await stack.deploy(pendingCore(row), { adopt: true });
      }, fault);
    });
  });
}

describe('Bao.Mount: a create killed before its claim, its path an Output', () => {
  it('never tunes the mount another stack owns; --adopt takes it over', async () => {
    const fault = refuseWriteOnce('/auth/approle/role/kv');
    const body = Effect.gen(function* () {
      const up = yield* BaoAuthRole('Upstream', {
        name: 'kv',
        secretIdTtl: '24h',
        tokenMaxTtl: '1h',
        tokenPolicies: ['default'],
        tokenTtl: '15m',
      });
      yield* BaoMount('Z', { defaultLeaseTtl: '15m', path: up.name, type: 'kv' });
    });
    await withCore(async (stack, _estate, seen, owner) => {
      await owner.deploy(BaoMount('X', { defaultLeaseTtl: '30m', path: 'kv', type: 'kv' }));
      await assert.rejects(stack.deploy(body), /injected/);
      seen.length = 0;
      await assert.rejects(stack.deploy(body), REFUSED);
      assert.deepEqual(writesBut(seen, '/auth/approle/role/kv'), []);
      await stack.deploy(body, { adopt: true });
    }, fault);
  });
});

/** Bao.MfaTotpMethod never renames (mfa-totp.ts), so it has no replace to interrupt. */
for (const row of FAMILIES.filter((each) => each.family !== 'Bao.MfaTotpMethod')) {
  describe(`${row.family}: a replace killed before its write`, () => {
    it('never writes over what another stack put at the new identity since; --adopt does', async () => {
      const suffix = row.family === 'Bao.JwtAuthConfig' ? '/b/config' : '/b';
      const fault = refuseWriteOnce(suffix);
      const { retain } = RemovalPolicy;
      await withEstate(async (stack, _estate, seen, owner) => {
        await stack.deploy(row.declare('X', 'a', '15m', retain));
        await assert.rejects(stack.deploy(row.declare('X', 'b', '15m', retain)), /injected/);
        await owner.deploy(row.declare('O', 'b', '30m'));
        seen.length = 0;
        await assert.rejects(stack.deploy(row.declare('X', 'b', '15m', retain)), RESUME_REFUSED);
        assert.deepEqual(writesOf(seen), []);
        await stack.deploy(row.declare('X', 'b', '15m', retain), { adopt: true });
        assert.notDeepEqual(writesOf(seen), []);
      }, fault);
    });
  });
}
