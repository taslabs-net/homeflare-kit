/**
 * `groups_scope:` — the one thing roles.yaml can say that its RESOURCE cannot.
 *
 * ⛔ THE POINT OF EVERY CASE BELOW IS THAT THE KEY IS LOAD-BEARING. One declaration is expanded
 *   twice, with the key and without it, against ONE map that holds BOTH ids of `Logs Read`. If the
 *   two runs ever resolve to the same id the key is decoration, and a test that only asserted the
 *   override would still pass — so the negative case is asserted beside it, every time.
 *
 * ★ THE IDS ARE THE LIVE ONES, MEASURED 2026-09-15 on `cloudflare-<account>-platform/
 *   permission-groups`: `Logs Read` is listed twice, `6a315a56…` at `com.cloudflare.api.account`
 *   and `c4a30cd5…` at `com.cloudflare.api.account.zone`. The second is what the four live
 *   security roles carry on their ACCOUNT resource, and what
 *   house/nix/homeflare-config/scripts/cf-mint-analytics-tokens.py:80 pins as PG_LOGS_ZONE.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GROUP_SCOPES,
  accountResource,
  groupKey,
  groupScopeNamed,
  scopeOfResource,
} from './cloudflare-group-scope.ts';
import { resolvePolicies } from './cloudflare-policy.ts';
import { RolesConfigError, parseRolesConfig } from './cloudflare-roles-config.ts';
import { type CloudflareZone, expandAll } from './cloudflare-roles-expand.ts';

const LOGS_READ_ACCOUNT = '6a315a56f18441e59ed03352369ae956';
const LOGS_READ_ZONE = 'c4a30cd58c5d42619c86a3c36c441e2d';

/** Both ids of the one name, filed the way the engine source files them. */
const IDS = new Map([
  [groupKey('Logs Read', GROUP_SCOPES.account), LOGS_READ_ACCOUNT],
  [groupKey('Logs Read', GROUP_SCOPES.zone), LOGS_READ_ZONE],
]);

const ZONES: Record<string, readonly CloudflareZone[]> = {
  acme: [{ id: 'zone-com', internal: false, name: 'example.com' }],
};

const yaml = (scope: string) => `
defaults: { namespace: homeflare }
surfaces:
  security:
    account_roles:
      - { name: logs-read, groups: [Logs Read],${scope} ttl: 15m, max_ttl: 1h, desc: 'L.' }
accounts:
  acme: { id: acct-acme, zones: all, surfaces: [security] }
`;

/** The single declaration, expanded with whatever `groups_scope:` text is given. */
const resolved = (scope: string) => {
  const roles = expandAll(parseRolesConfig(yaml(scope)), ZONES).get('cloudflare-acme-security');
  const role = roles?.find((r) => r.name === 'logs-read');
  assert.ok(role, 'logs-read was not expanded');
  const { missing, policies } = resolvePolicies(role.policies, IDS);
  assert.deepEqual(missing, []);
  return policies;
};

describe('groups_scope', () => {
  it('resolves the ZONE id on an ACCOUNT resource when the key says so', () => {
    const [entry] = resolved(' groups_scope: zone,');
    assert.ok(entry);
    // ⛔ THE RESOURCE IS STILL THE ACCOUNT. The key moves the lookup, never the binding — that is
    //   Cloudflare's "all zones from an account" (cf-mint-analytics-tokens.py:155-158).
    assert.deepEqual(Object.keys(entry.resources), [accountResource('acct-acme')]);
    assert.deepEqual(entry.groupIds, [LOGS_READ_ZONE]);
  });

  it('resolves the ACCOUNT id from the same declaration without the key', () => {
    const [entry] = resolved('');
    assert.ok(entry);
    assert.deepEqual(Object.keys(entry.resources), [accountResource('acct-acme')]);
    assert.deepEqual(entry.groupIds, [LOGS_READ_ACCOUNT]);
    assert.notEqual(LOGS_READ_ACCOUNT, LOGS_READ_ZONE);
  });

  /**
   * ⚠️ THE FIELD IS ABSENT, NOT `undefined`-VALUED, WHEN THE yaml IS SILENT. The declaration is
   *   Alchemy props: a key that appeared on all 594 roles would rewrite every stored prop set to
   *   restate what the resource already says.
   */
  it('leaves `scope` off every entry that does not declare it', () => {
    const roles = expandAll(parseRolesConfig(yaml('')), ZONES).get('cloudflare-acme-security');
    const entry = roles?.[0]?.policies[0];
    assert.ok(entry);
    assert.equal('scope' in entry, false);
    assert.equal(scopeOfResource(accountResource('acct-acme')), GROUP_SCOPES.account);
  });

  it('refuses a word that is not one of the three scopes', () => {
    assert.throws(() => parseRolesConfig(yaml(' groups_scope: zonee,')), RolesConfigError);
    // ⛔ AND REFUSES THE NAMESPACE ITSELF. roles.yaml writes the short word; a namespace typed
    //   there would be a string any looser check would wave through.
    assert.throws(
      () => parseRolesConfig(yaml(" groups_scope: 'com.cloudflare.api.account.zone',")),
      RolesConfigError,
    );
    assert.equal(groupScopeNamed('bucket'), GROUP_SCOPES.bucket);
    assert.equal(groupScopeNamed('zonee'), undefined);
  });
});
