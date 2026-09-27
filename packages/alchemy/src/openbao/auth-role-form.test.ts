/**
 * Bao.AuthRole's secret_id TTL at the 90-day length the per-host AppRoles use.
 *
 * ★ OPENBAO ACCEPTS `2160h`. MEASURED 2026-09-21 with a Go probe of
 *   sdk v2.6.2 framework.FieldData.Validate on the approle role fields (path_role.go:166-167,
 *   TypeDurationSecond): `secret_id_ttl: "2160h"` validates and parses to 7776000 seconds. A role
 *   read hands back that integer, which attributesOf renders as `90d` — the same role.
 * The SDK now sends the equivalent seconds directly instead of the former CLI duration string.
 * (What the diff calls a rename is pinned in rename-families.test.ts, `foldName`.)
 */
import { describe, expect, it } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type BaoAuthRoleProps, attributesOf, matches } from './auth-role-form.ts';
import { authRoleRequest } from './auth-role-wire.ts';

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
  it('writes 2160h as the equivalent SDK seconds', async () => {
    expect((await Effect.runPromise(authRoleRequest(PROPS))).secret_id_ttl).toBe(7776000);
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
    expect(attributes.secretIdTtl).toBe('90d');
    expect(matches(attributes, PROPS)).toBe(true);
    expect(matches(attributesOf(PROPS, { ...live, secret_id_ttl: 0 }), PROPS)).toBe(false);
  });
});
