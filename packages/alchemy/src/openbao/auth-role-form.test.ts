/**
 * Bao.AuthRole's secret_id TTL at the 90-day length the per-host AppRoles use.
 *
 * ★ `2160h` IS WHAT GOES ON THE WIRE, AND OPENBAO ACCEPTS IT. MEASURED 2026-09-21 with a Go probe of
 *   sdk v2.6.2 framework.FieldData.Validate on the approle role fields (path_role.go:166-167,
 *   TypeDurationSecond): `secret_id_ttl: "2160h"` validates and parses to 7776000 seconds. A role
 *   read hands back that integer, which attributesOf renders as `90d` — the same role.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BaoAuthRoleProps, attributesOf, matches, writeBody } from './auth-role-form.ts';

const PROPS: BaoAuthRoleProps = {
  bindSecretId: true,
  name: 'host-cert',
  secretIdNumUses: 0,
  secretIdTtl: '2160h',
  tokenMaxTtl: '1h',
  tokenPolicies: ['host-cert', 'default'],
  tokenTtl: '15m',
};

describe('auth role secret_id TTL', () => {
  it('writes 2160h as given', () => {
    assert.equal(writeBody(PROPS)['secret_id_ttl'], '2160h');
  });

  it('reads 7776000 seconds back as the same role', () => {
    const live = {
      bind_secret_id: true,
      secret_id_num_uses: 0,
      secret_id_ttl: 7776000,
      token_max_ttl: 3600,
      token_policies: ['default', 'host-cert'],
      token_ttl: 900,
    };
    const attributes = attributesOf(PROPS, live);
    assert.equal(attributes.secretIdTtl, '90d');
    assert.equal(matches(attributes, PROPS), true);
    assert.equal(matches(attributesOf(PROPS, { ...live, secret_id_ttl: 0 }), PROPS), false);
  });
});
