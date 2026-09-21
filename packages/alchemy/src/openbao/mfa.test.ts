/**
 * Login MFA against a fake: a TOTP method found by name in THIS namespace only, and an enforcement
 * whose mount paths resolve to accessors and whose lists always go over as arrays. Ids and names are
 * placeholders.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Reply, type Seen, run, withFake } from './fake-bao.ts';
import { planEnforcement, reconcileEnforcement } from './mfa-enforcement.ts';
import { planTotp, reconcileTotp } from './mfa-totp.ts';
import { renameProblem } from './mfa-totp-form.ts';

const ENV = (address: string) => ({ BAO_ADDR: address, BAO_NAMESPACE: 'team-a' });
const TOTP = { issuer: 'vault-example', name: 'admin-totp' };
const METHOD_ID = '00000000-0000-4000-8000-00000000000a';
const stored = (namespacePath: string, extra: Record<string, unknown> = {}) => ({
  algorithm: 'SHA1',
  digits: 6,
  id: METHOD_ID,
  issuer: 'vault-example',
  key_size: 20,
  max_validation_attempts: 5,
  name: 'admin-totp',
  namespace_path: namespacePath,
  period: 30,
  qr_size: 200,
  skew: 1,
  type: 'totp',
  ...extra,
});
const listing = (...entries: Record<string, unknown>[]): Reply =>
  entries.length === 0
    ? { json: { errors: [] }, status: 404 }
    : {
        json: {
          data: {
            key_info: Object.fromEntries(entries.map((e, i) => [`id-${String(i)}`, e])),
            keys: [],
          },
        },
        status: 200,
      };

/** Listing replies in order (the last repeats); every write answers 200. */
const totpFake = (...lists: Reply[]) => {
  let reads = 0;
  return (seen: Seen): Reply => {
    if (seen.method !== 'GET') return { json: { data: { method_id: METHOD_ID } }, status: 200 };
    const reply = lists[Math.min(reads, lists.length - 1)] ?? listing();
    reads += 1;
    return reply;
  };
};
const writes = (seen: Seen[]) => seen.filter((each) => each.method !== 'GET');

describe('Bao.MfaTotpMethod', () => {
  it('upserts by method_name when absent, and returns the id it read back', async () => {
    await withFake(totpFake(listing(), listing(stored('team-a/'))), async (bao) => {
      const attributes = await run(ENV(bao.address), reconcileTotp(TOTP));
      assert.equal(attributes.methodId, 'id-0');
      const [write] = writes(bao.seen);
      assert.equal(write?.path, '/v1/identity/mfa/method/totp');
      const body = JSON.parse(write?.body ?? '{}') as Record<string, unknown>;
      assert.equal(body['method_name'], 'admin-totp');
      assert.equal(body['method_id'], undefined);
      assert.equal(body['period'], '30s');
    });
  });

  it('plans noop and writes nothing when this namespace already has it', async () => {
    await withFake(totpFake(listing(stored('team-a/'))), async (bao) => {
      assert.equal(await run(ENV(bao.address), planTotp(TOTP)), 'noop');
      await run(ENV(bao.address), reconcileTotp(TOTP));
      assert.equal(writes(bao.seen).length, 0);
    });
  });

  it("ignores a same-named method in a parent namespace — it is not this namespace's", async () => {
    await withFake(
      totpFake(listing(stored('')), listing(stored(''), stored('team-a/'))),
      async (bao) => {
        await run(ENV(bao.address), reconcileTotp(TOTP));
        assert.equal(writes(bao.seen).length, 1);
      },
    );
  });

  it('refuses a rename at plan time — a new id would strand every enrolled secret', () => {
    assert.equal(renameProblem('admin-totp', 'admin-totp'), undefined);
    assert.match(renameProblem('admin-totp', 'admin-otp') ?? '', /strand every enrolled secret/);
  });

  it('refuses a name another method type holds here — a TOTP write would convert it', async () => {
    await withFake(totpFake(listing(stored('team-a/', { type: 'duo' }))), async (bao) => {
      await assert.rejects(run(ENV(bao.address), reconcileTotp(TOTP)), /belongs to a duo method/);
      assert.equal(writes(bao.seen).length, 0);
      // ★ The GLOBAL listing — the per-type one cannot see a Duo method at all.
      assert.equal(bao.seen[0]?.path, '/v1/identity/mfa/method?list=true');
    });
  });

  it('plans update on drift, and refuses a bad declaration before any call', async () => {
    await withFake(totpFake(listing(stored('team-a/', { digits: 8 }))), async (bao) => {
      assert.equal(await run(ENV(bao.address), planTotp(TOTP)), 'update');
    });
    await withFake(totpFake(listing()), async (bao) => {
      await assert.rejects(
        run(ENV(bao.address), reconcileTotp({ ...TOTP, issuer: '' })),
        /issuer is empty/,
      );
      assert.equal(bao.seen.length, 0);
    });
  });
});

const AUTH_TABLE: Reply = {
  json: {
    data: {
      'oidc/': { accessor: 'auth_oidc_1', type: 'oidc' },
      'token/': { accessor: 'auth_token_1', type: 'token' },
    },
  },
  status: 200,
};
const ENFORCE = { authMethodPaths: ['oidc'], mfaMethodIds: [METHOD_ID], name: 'admin-mfa' };
const enforcementLive = (accessors: string[]) => ({
  json: {
    data: {
      auth_method_accessors: accessors,
      auth_method_types: [],
      id: 'enf-1',
      identity_entity_ids: [],
      identity_group_ids: [],
      mfa_method_ids: [METHOD_ID],
      name: 'admin-mfa',
      namespace_path: 'team-a/',
    },
  },
  status: 200,
});

/** sys/auth answers the table; the enforcement answers `states` in order; writes answer 204. */
const enforcementFake = (...states: Reply[]) => {
  let reads = 0;
  return (seen: Seen): Reply => {
    if (seen.path === '/v1/sys/auth') return AUTH_TABLE;
    if (seen.method !== 'GET') return { status: 204 };
    const reply = states[Math.min(reads, states.length - 1)] ?? {
      json: { errors: [] },
      status: 404,
    };
    reads += 1;
    return reply;
  };
};

describe('Bao.MfaLoginEnforcement', () => {
  it('resolves mount paths to accessors and sends every list as an array', async () => {
    const absent = { json: { errors: [] }, status: 404 };
    await withFake(enforcementFake(absent, enforcementLive(['auth_oidc_1'])), async (bao) => {
      const attributes = await run(ENV(bao.address), reconcileEnforcement(ENFORCE));
      assert.equal(attributes.enforcementId, 'enf-1');
      const [write] = writes(bao.seen);
      assert.equal(write?.path, '/v1/identity/mfa/login-enforcement/admin-mfa');
      assert.deepEqual(JSON.parse(write?.body ?? '{}'), {
        auth_method_accessors: ['auth_oidc_1'],
        auth_method_types: [],
        identity_entity_ids: [],
        identity_group_ids: [],
        mfa_method_ids: [METHOD_ID],
      });
    });
  });

  it('plans update when live carries a target the declaration does not', async () => {
    await withFake(
      enforcementFake(enforcementLive(['auth_oidc_1', 'auth_token_1'])),
      async (bao) => {
        assert.equal(await run(ENV(bao.address), planEnforcement(ENFORCE)), 'update');
      },
    );
    await withFake(enforcementFake(enforcementLive(['auth_oidc_1'])), async (bao) => {
      assert.equal(await run(ENV(bao.address), planEnforcement(ENFORCE)), 'noop');
    });
  });

  it('refuses a path with no mount, and an enforcement with no target, before writing', async () => {
    await withFake(enforcementFake(), async (bao) => {
      await assert.rejects(
        run(ENV(bao.address), reconcileEnforcement({ ...ENFORCE, authMethodPaths: ['jwt-admin'] })),
        /no auth mount at jwt-admin/,
      );
      await assert.rejects(
        run(ENV(bao.address), reconcileEnforcement({ ...ENFORCE, authMethodPaths: [] })),
        /enforces NOTHING/,
      );
      assert.equal(writes(bao.seen).length, 0);
    });
  });
});
