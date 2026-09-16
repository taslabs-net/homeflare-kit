/**
 * The equality Bao.CloudflareRole's diff and reconcile rest on: TTLs as seconds, description
 * exactly, and policies with order significant in a declared entry and insignificant in the
 * account entry the Python sorted. Plus the write body and the refusals.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { atEveryScope, resolvePolicies } from './cloudflare-policy.ts';
import {
  type BaoCloudflareRoleProps,
  attributesOf,
  differences,
  liveRoleOf,
  refusalOf,
  writeBody,
} from './cloudflare-role-form.ts';

const ZONE = 'com.cloudflare.api.account.zone.z1';
const ACCOUNT = 'com.cloudflare.api.account.acct';

const PROPS: BaoCloudflareRoleProps = {
  description: 'Deploy with a route. (zone: example.com)',
  maxTtl: '2h',
  mount: 'cloudflare-acme-platform',
  name: 'example-com-workers-deploy-full',
  policies: [
    {
      effect: 'allow',
      groupOrder: 'declared',
      groups: ['Routes Write', 'DNS Write'],
      resource: ZONE,
    },
    {
      effect: 'allow',
      groupOrder: 'by-id',
      groups: ['Scripts Write', 'Containers Write'],
      resource: ACCOUNT,
    },
  ],
  ttl: '30m',
};

const IDS = new Map([
  ['Containers Write', 'c'],
  ['DNS Write', 'd'],
  ['Routes Write', 'r'],
  ['Scripts Write', 's'],
]);

const { policies: RESOLVED } = resolvePolicies(PROPS.policies, atEveryScope(IDS));

/** A policies string in the engine's own marshalled shape. */
const wire = (entries: [string, string[]][]) =>
  JSON.stringify(
    entries.map(([resource, ids]) => ({
      effect: 'allow',
      resources: { [resource]: '*' },
      permission_groups: ids.map((id) => ({ id })),
    })),
  );

const live = (overrides: Record<string, unknown> = {}) =>
  liveRoleOf({
    description: PROPS.description,
    max_ttl: 7200,
    name: PROPS.name,
    policies: wire([
      [ZONE, ['r', 'd']],
      [ACCOUNT, ['c', 's']],
    ]),
    ttl: 1800,
    ...overrides,
  });

const fields = (role = live(), props: BaoCloudflareRoleProps = PROPS) =>
  differences(props, RESOLVED, role).map((d) => d.field);

describe('differences', () => {
  it('is empty when live matches, TTL text compared to engine seconds', () => {
    assert.deepEqual(fields(), []);
  });

  it('reads the account entry as a sorted set, because the Python sorted it', () => {
    const reordered = wire([
      [ZONE, ['r', 'd']],
      [ACCOUNT, ['s', 'c']],
    ]);
    assert.deepEqual(fields(live({ policies: reordered })), []);
  });

  it('keeps group order significant in a declared entry', () => {
    const reordered = wire([
      [ZONE, ['d', 'r']],
      [ACCOUNT, ['c', 's']],
    ]);
    assert.deepEqual(fields(live({ policies: reordered })), ['policies']);
  });

  // The drift role's shape on 2026-09-14: the same entries, account first.
  it('keeps entry order significant', () => {
    const swapped = wire([
      [ACCOUNT, ['c', 's']],
      [ZONE, ['r', 'd']],
    ]);
    assert.deepEqual(fields(live({ policies: swapped })), ['policies']);
  });

  it('catches a different resource, a missing group and an extra entry', () => {
    for (const policies of [
      wire([
        [`${ZONE}x`, ['r', 'd']],
        [ACCOUNT, ['c', 's']],
      ]),
      wire([
        [ZONE, ['r', 'd']],
        [ACCOUNT, ['c']],
      ]),
      wire([
        [ZONE, ['r', 'd']],
        [ACCOUNT, ['c', 's']],
        [ACCOUNT, ['c']],
      ]),
    ]) {
      assert.deepEqual(fields(live({ policies })), ['policies'], policies);
    }
  });

  it('names description, ttl and max_ttl separately', () => {
    const drifted = live({ description: 'widened by hand', max_ttl: 3600, ttl: 600 });
    assert.deepEqual(fields(drifted), ['description', 'ttl', 'max_ttl']);
  });

  it('treats live policies that are not a policy document as different', () => {
    assert.deepEqual(fields(live({ policies: 'not json' })), ['policies']);
    assert.deepEqual(fields(live({ policies: '[{"effect":"allow"}]' })), ['policies']);
  });

  it('never equals an unparseable declared ttl, and reconcile refuses it', () => {
    const props = { ...PROPS, ttl: '1h30m' };
    assert.deepEqual(fields(live(), props), ['ttl']);
    assert.match(refusalOf(props) ?? '', /unparseable duration ttl=1h30m/);
  });
});

describe('writeBody', () => {
  it('sends the four fields apply-roles.py sent, policies in the engine shape with sorted account IDs', () => {
    const body = writeBody(PROPS, RESOLVED);
    assert.deepEqual(Object.keys(body).sort(), ['description', 'max_ttl', 'policies', 'ttl']);
    assert.deepEqual([body.ttl, body.max_ttl, body.description], ['30m', '2h', PROPS.description]);
    assert.equal(
      body.policies,
      wire([
        [ZONE, ['r', 'd']],
        [ACCOUNT, ['c', 's']],
      ]),
    );
  });
});

describe('refusalOf and attributesOf', () => {
  it('refuses no policies and a policy with no groups', () => {
    assert.equal(refusalOf(PROPS), undefined);
    assert.equal(refusalOf({ ...PROPS, policies: [] }), 'no policy entries');
    const empty = [
      { effect: 'allow' as const, groupOrder: 'declared' as const, groups: [], resource: ZONE },
    ];
    assert.equal(refusalOf({ ...PROPS, policies: empty }), 'a policy with no groups');
  });

  it('builds attributes from live only, with a stable digest', () => {
    const attrs = attributesOf(PROPS, live({ description: 'live says this' }));
    assert.equal(attrs.description, 'live says this');
    assert.deepEqual([attrs.ttl, attrs.maxTtl, attrs.mount], [1800, 7200, PROPS.mount]);
    assert.equal(attrs.digest, attributesOf(PROPS, live({ description: 'live says this' })).digest);
    assert.notEqual(attrs.digest, attributesOf(PROPS, live()).digest);
  });
});
