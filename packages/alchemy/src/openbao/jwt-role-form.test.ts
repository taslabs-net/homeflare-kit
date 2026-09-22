/**
 * Bao.JwtRole's form. Worth pinning: the body carries the four fields the server RESETS when they
 * are omitted, maps go over as objects, a role read back from OpenBao compares equal to its
 * declaration, and the server's own refusals are refused here first. Values are placeholders.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoJwtRoleProps,
  attributesOf,
  matches,
  problems,
  writeBody,
} from './jwt-role-form.ts';

const CI: BaoJwtRoleProps = {
  boundAudiences: ['https://github.com/example-org'],
  boundClaims: { ref: 'refs/heads/main', repository: ['example-org/app', 'example-org/api'] },
  boundClaimsType: 'glob',
  mount: 'jwt-github',
  name: 'ci-app',
  roleType: 'jwt',
  tokenMaxTtl: '30m',
  tokenPolicies: ['ci-app-deploy'],
  tokenTtl: '10m',
  userClaim: 'repository',
};

/** What OpenBao 2.6.2 answers for CI after the write (path_role.go pathRoleRead + tokenutil). */
const LIVE: Record<string, unknown> = {
  allowed_redirect_uris: null,
  bound_audiences: ['https://github.com/example-org'],
  bound_claims: { ref: 'refs/heads/main', repository: ['example-org/api', 'example-org/app'] },
  bound_claims_type: 'glob',
  bound_subject: '',
  callback_mode: 'client',
  claim_mappings: null,
  clock_skew_leeway: 60,
  groups_claim: '',
  oidc_disable_confirmation: false,
  oidc_scopes: null,
  role_type: 'jwt',
  token_bound_cidrs: [],
  token_explicit_max_ttl: 0,
  token_max_ttl: 1800,
  token_no_default_policy: false,
  token_num_uses: 0,
  token_period: 0,
  token_policies: ['ci-app-deploy'],
  token_ttl: 600,
  token_type: 'default',
  user_claim: 'repository',
  verbose_oidc_logging: false,
};

const same = (live: Record<string, unknown>, props = CI) =>
  matches(attributesOf(props, live), props);

describe('jwt role form', () => {
  it('reads the role OpenBao stored as the role that was declared', () => {
    assert.equal(same(LIVE), true);
  });

  it('sends the four fields the server resets when omitted, and maps as objects', () => {
    const body = writeBody(CI);
    assert.equal(body['role_type'], 'jwt');
    assert.equal(body['bound_claims_type'], 'glob');
    assert.equal(body['callback_mode'], 'client');
    assert.equal(body['oidc_disable_confirmation'], false);
    assert.equal(body['verbose_oidc_logging'], false);
    assert.deepEqual(body['bound_claims'], CI.boundClaims);
    assert.deepEqual(body['claim_mappings'], {});
    assert.deepEqual(body['token_policies'], ['ci-app-deploy']);
  });

  it('sends every token_* field at its default — the write merges, so an omitted one stays stale', () => {
    const bare: BaoJwtRoleProps = {
      boundSubject: 'repo:example-org/app:ref:refs/heads/main',
      name: 'bare',
      roleType: 'jwt',
      tokenPolicies: [],
      userClaim: 'sub',
    };
    const token = Object.fromEntries(
      Object.entries(writeBody(bare)).filter(([key]) => key.startsWith('token_')),
    );
    assert.deepEqual(token, {
      token_bound_cidrs: [],
      token_explicit_max_ttl: '0',
      token_max_ttl: '0',
      token_no_default_policy: false,
      token_num_uses: 0,
      token_period: '0',
      token_policies: [],
      token_ttl: '0',
      token_type: 'default',
    });
  });

  it('plans update for drift on a managed field, including the two fixed-false ones', () => {
    const drifted: [string, unknown][] = [
      ['verbose_oidc_logging', true],
      ['oidc_disable_confirmation', true],
      ['role_type', 'oidc'],
      ['token_policies', ['ci-app-deploy', 'admin']],
      ['bound_audiences', ['https://github.com/other-org']],
      ['token_ttl', 3600],
    ];
    for (const [field, value] of drifted)
      assert.equal(same({ ...LIVE, [field]: value }), false, field);
  });

  it('treats a claim value and a one-element list as the same', () => {
    const props = {
      ...CI,
      boundClaims: { ref: ['refs/heads/main'], repository: CI.boundClaims?.['repository'] ?? [] },
    };
    assert.equal(same(LIVE, props), true);
  });

  it('refuses what the server would refuse, before any call', () => {
    assert.deepEqual(problems(CI), []);
    const loose = { ...CI, boundAudiences: [], boundClaims: {} };
    assert.match(problems(loose).join(), /bound constraint/);
    assert.match(problems({ ...CI, roleType: 'oidc' }).join(), /allowedRedirectUris/);
    assert.match(problems({ ...CI, name: 'CI-App' }).join(), /lower case/);
    assert.match(problems({ ...CI, claimMappings: { email: 'role' } }).join(), /reserved/);
    assert.match(problems({ ...CI, tokenTtl: '2h' }).join(), /longer than tokenMaxTtl/);
  });
});
