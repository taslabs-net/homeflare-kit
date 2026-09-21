/**
 * The shared role loop against a fake, through Bao.JwtAuthConfig — the family where `wouldErase`
 * matters most: a live OIDC client must never be written over, because the write would erase a
 * secret the read never shows.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Reply, type Seen, run, withFake } from './fake-bao.ts';
import { jwtConfigSpec } from './jwt-config.ts';
import { problems } from './jwt-config-form.ts';
import { planRole, reconcileRole } from './role-reconcile.ts';

const PROPS = {
  boundIssuer: 'https://token.actions.example.com',
  mount: 'jwt-github',
  oidcDiscoveryUrl: 'https://token.actions.example.com',
};

const STORED = {
  bound_issuer: 'https://token.actions.example.com',
  default_role: '',
  jwks_ca_pem: '',
  jwks_url: '',
  jwt_supported_algs: [],
  jwt_validation_pubkeys: [],
  namespace_in_state: true,
  oidc_client_id: '',
  oidc_discovery_ca_pem: '',
  oidc_discovery_url: 'https://token.actions.example.com',
  oidc_response_mode: '',
  oidc_response_types: [],
  override_allowed_server_names: null,
  provider_config: {},
  status: 'valid',
};

/** Reads answer from `reads` in order (the last repeats); writes answer 204. */
const script = (...reads: Reply[]) => {
  let count = 0;
  return (seen: Seen): Reply => {
    if (seen.method !== 'GET') return { status: 204 };
    const reply = reads[Math.min(count, reads.length - 1)] ?? { status: 500 };
    count += 1;
    return reply;
  };
};
const ABSENT: Reply = { json: { errors: [] }, status: 404 };
const found = (data: Record<string, unknown>): Reply => ({ json: { data }, status: 200 });
const writes = (seen: Seen[]) => seen.filter((each) => each.method !== 'GET');

describe('role loop (Bao.JwtAuthConfig)', () => {
  it('writes an absent config once, as PUT, and returns what it read back', async () => {
    await withFake(script(ABSENT, found(STORED)), async (bao) => {
      const attributes = await run({ BAO_ADDR: bao.address }, reconcileRole(jwtConfigSpec(PROPS)));
      assert.equal(attributes.mount, 'jwt-github');
      const [write] = writes(bao.seen);
      assert.equal(write?.method, 'PUT');
      assert.equal(write?.path, '/v1/auth/jwt-github/config');
      assert.ok(!(write?.body ?? '').includes('oidc_client_secret'));
    });
  });

  it('writes nothing and plans noop when live already matches', async () => {
    await withFake(script(found(STORED)), async (bao) => {
      assert.equal(await run({ BAO_ADDR: bao.address }, planRole(jwtConfigSpec(PROPS))), 'noop');
      await run({ BAO_ADDR: bao.address }, reconcileRole(jwtConfigSpec(PROPS)));
      assert.equal(writes(bao.seen).length, 0);
    });
  });

  it('refuses to write over a live OIDC client, naming what would be erased', async () => {
    const oidc = found({
      ...STORED,
      bound_issuer: 'https://old.example.com',
      oidc_client_id: 'client-a',
    });
    await withFake(script(oidc), async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcileRole(jwtConfigSpec(PROPS))),
        /oidc_client_id \(and its unreadable secret\)/,
      );
      assert.equal(writes(bao.seen).length, 0);
    });
  });

  it('refuses a write that reads back different', async () => {
    const other = found({ ...STORED, bound_issuer: 'https://elsewhere.example.com' });
    await withFake(script(ABSENT, other), async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcileRole(jwtConfigSpec(PROPS))),
        /read back different/,
      );
    });
  });

  it('plans update, never noop, for a declaration it would refuse', async () => {
    const bad = { ...PROPS, jwksUrl: 'https://keys.example.com' };
    assert.match(problems(bad).join(), /exactly one/);
    await withFake(script(found(STORED)), async (bao) => {
      assert.equal(await run({ BAO_ADDR: bao.address }, planRole(jwtConfigSpec(bad))), 'update');
      assert.equal(bao.seen.length, 0);
    });
  });
});
