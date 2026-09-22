/**
 * R2 BUCKET-scoped roles: the third resource form, beside `zoneResource` and `accountResource`.
 *
 * ★ ITS OWN FILE, AND ITS OWN INLINE YAML, FOR TWO REASONS. The shared fixture
 *   (cloudflare-roles.fixture.yaml) is a miniature of the REAL roles.yaml and every assertion in
 *   cloudflare-roles-expand.test.ts counts its roles by name — adding two there moves four
 *   unrelated expectations for no gain. And a bucket role needs no zones at all, so the smallest
 *   thing that can prove it is three lines of yaml rather than a 64-line fixture.
 * ⚠️ THE SPLIT IS ALSO THE CAP. The shared file is 229 lines against a 250 cap; these cases were
 *   written there first and pushed it to 302. AGENTS.md rule 5 says extract, never compress —
 *   the comments are the expensive part.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketResource } from './cloudflare-group-scope.ts';
import { RolesConfigError, parseRolesConfig } from './cloudflare-roles-config.ts';
import { type CloudflareZone, type ExpandedRole, expandAll } from './cloudflare-roles-expand.ts';

/**
 * ⚠️ ONE ZONE, AND IT EXISTS ONLY SO `expandAll` HAS AN INVENTORY. An account with no zone
 *   inventory is an ERROR there (a missing inventory is not the same as an empty one), so a bucket
 *   role — which is an account role and touches no zone — still needs this to be present.
 */
const ZONES: Record<string, readonly CloudflareZone[]> = {
  acme: [{ id: 'zone-com', internal: false, name: 'example.com' }],
};

const yaml = (roles: string) => `
defaults: { namespace: homeflare }
surfaces:
  platform:
${roles}
accounts:
  acme: { id: acct-acme, zones: all, surfaces: [platform] }
`;

const ACCOUNT_ROLES = yaml(`    account_roles:
      - {
          name: r2-backup-demo,
          groups: [Workers R2 Storage Bucket Item Write, Workers R2 Storage Bucket Item Read],
          bucket: demo-pg-bucket,
          ttl: 12h,
          max_ttl: 12h,
          desc: 'Write one bucket and nothing else.',
        }
      - { name: r2-backup-eu, groups: [Workers R2 Storage Bucket Item Read],
          bucket: demo-eu-bucket, bucket_jurisdiction: eu, ttl: 12h, max_ttl: 12h, desc: 'EU.' }
      - { name: workers-deploy, groups: [Workers Scripts Write], ttl: 30m, max_ttl: 2h, desc: 'W.' }
`);

const expanded = expandAll(parseRolesConfig(ACCOUNT_ROLES), ZONES);

const role = (name: string): ExpandedRole => {
  const found = expanded.get('cloudflare-acme-platform')?.find((r) => r.name === name);
  assert.ok(found, `${name} was not expanded`);
  return found;
};

describe('R2 bucket-scoped roles', () => {
  /**
   * ⛔ THE UNDERSCORES ARE THE ASSERTION, not the prefix. `com.cloudflare.edge.r2.bucket.` then
   *   `<accountId>_<jurisdiction>_<bucket>` as ONE dotted segment is what Cloudflare's R2 token
   *   documentation specifies. A dot where an underscore belongs still mints a token; that token
   *   matches no bucket and is refused on first use, which is indistinguishable at the call site
   *   from a missing permission group. This is the only place that difference is ever checked.
   */
  it('scopes the policy to one bucket, in the edge.r2 namespace', () => {
    assert.deepEqual(role('r2-backup-demo').policies, [
      {
        effect: 'allow',
        groupOrder: 'declared',
        groups: ['Workers R2 Storage Bucket Item Write', 'Workers R2 Storage Bucket Item Read'],
        resource: 'com.cloudflare.edge.r2.bucket.acct-acme_default_demo-pg-bucket',
      },
    ]);
  });

  /** ⚠️ THE DEFAULT IS UNCHANGED: every role declared before 2026-09-15 stays account-wide. */
  it('leaves a role with no bucket on the account resource', () => {
    assert.equal(
      role('workers-deploy').policies[0]?.resource,
      'com.cloudflare.api.account.acct-acme',
    );
  });

  /**
   * ⛔ THE JURISDICTION IS PART OF THE IDENTITY, NOT DECORATION. A bucket of the same name under
   *   `eu` is a DIFFERENT resource, so defaulting it silently would hand out a token for a bucket
   *   that does not exist. Every bucket in this estate is `default` (measured on all 34), which is
   *   exactly why the non-default path needs a test rather than a comment.
   */
  it('puts the jurisdiction in the middle segment', () => {
    assert.equal(
      role('r2-backup-eu').policies[0]?.resource,
      'com.cloudflare.edge.r2.bucket.acct-acme_eu_demo-eu-bucket',
    );
    assert.equal(bucketResource('a', 'default', 'b'), 'com.cloudflare.edge.r2.bucket.a_default_b');
  });

  /**
   * ⚠️ THE KV CATALOG SHAPE IS DELIBERATELY UNCHANGED. cloudflare-parity-catalog.ts proves the TS
   *   catalog against what apply-roles.py published, so a new field here would read as drift on
   *   every one of 555 roles. The bucket is stated in `desc` and shown by `--plan` instead.
   */
  it('does not move the catalog shape', () => {
    assert.deepEqual(role('r2-backup-demo').catalog, {
      description: 'Write one bucket and nothing else.',
      maxTtl: '12h',
      permissions: ['Workers R2 Storage Bucket Item Write', 'Workers R2 Storage Bucket Item Read'],
      ttl: '12h',
      zone: null,
    });
  });

  /**
   * ⛔ A ZONE ROLE SCOPED TO A BUCKET IS INCOHERENT, NOT NARROW. The groups a zone role carries are
   *   gated at the zone; against a bucket resource every one of them is refused. roles.yaml cannot
   *   express the contradiction as a type, so the expansion is the only place it can be caught.
   */
  it('refuses a zone role that names a bucket', () => {
    const bad = yaml(`    zone_roles:
      - { name: nope, groups: [DNS Read], bucket: b, ttl: 5m, max_ttl: 1h, desc: '' }
`);
    assert.throws(() => expandAll(parseRolesConfig(bad), ZONES), /zone role cannot be scoped/);
  });

  /** ⛔ `bucket: ''` would expand to `…_default_` — neither a bucket nor the account. */
  it('refuses an empty bucket rather than defaulting it', () => {
    const bad = yaml(`    account_roles:
      - { name: nope, groups: [DNS Read], bucket: '', ttl: 5m, max_ttl: 1h, desc: '' }
`);
    assert.throws(() => parseRolesConfig(bad), RolesConfigError);
  });
});
