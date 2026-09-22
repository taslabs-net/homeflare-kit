/**
 * Both permission-group sources against fake-bao: (a) the engine endpoint — resolved and cached per
 * mount, the seven live two-id names separated by scope, the bucket-scoped R2 pair, unknown, a
 * two-id name asked at a scope it is not listed at, DENIED, undeployed and still-ambiguous;
 * (b) ⚠️ the live-roles bootstrap — resolved across an account's mounts, unknown, and ambiguous
 * when a live role contradicts the rest.
 *
 * ★ (a)'s FIXTURE IS THE LIVE LIST'S SHAPE, ids and all, transcribed from `bao read
 *   cloudflare-<account>-platform/permission-groups` on 2026-09-15 — the seven pairs are the
 *   reason this file's key is (name, scope) and not name.
 *
 * ⚠️ (b)'s CASES STAY, AND ARE NOT VACUOUS, THOUGH THE STACK STOPPED WIRING IT ON 2026-09-15.
 *   `permissionGroupsBootstrapLayer` is kept as the only source that works while the
 *   `permission-groups` grant is unapplied (cloudflare-roles.ts), so these four are the proof it
 *   still works when it is reached for. They retire with the function, not before.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import { GROUP_SCOPES, groupKey } from './cloudflare-group-scope.ts';
import {
  CloudflareGroupsError,
  type GroupRef,
  permissionGroupsFromEngine,
  permissionGroupsFromLiveRoles,
} from './cloudflare-permission-groups.ts';
import type { ExpandedRole } from './cloudflare-roles-expand.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';

const MOUNT = 'cloudflare-acme-dns';

const engine =
  (groups: unknown[]) =>
  (seen: Seen): Reply =>
    seen.path === `/v1/${MOUNT}/permission-groups`
      ? { json: { data: { permission_groups: groups } }, status: 200 }
      : { json: { errors: [] }, status: 404 };

const resolveWith = <E>(
  source: Effect.Effect<{ resolve: (m: string, r: readonly GroupRef[]) => E }>,
) => source;

const at = (scope: string) => (name: string) => ({ name, scope });
const zone = at(GROUP_SCOPES.zone);
const account = at(GROUP_SCOPES.account);
const bucket = at(GROUP_SCOPES.bucket);

describe('permissionGroupsFromEngine', () => {
  const GROUPS = [
    { id: 'id-read', name: 'DNS Read', scopes: ['com.cloudflare.api.account.zone'] },
    { id: 'id-write', name: 'DNS Write', scopes: ['com.cloudflare.api.account.zone'] },
  ];

  it('resolves names from GET <mount>/permission-groups, asking once per mount', async () => {
    await withFake(engine(GROUPS), async (bao) => {
      const resolved = await run(
        { BAO_ADDR: bao.address },
        Effect.flatMap(resolveWith(permissionGroupsFromEngine()), (groups) =>
          Effect.zip(
            groups.resolve(MOUNT, [zone('DNS Read')]),
            groups.resolve(`${MOUNT}/`, [zone('DNS Write')]),
          ),
        ),
      );
      assert.deepEqual(
        resolved.map((map) => Object.fromEntries(map)),
        [
          { [groupKey('DNS Read', GROUP_SCOPES.zone)]: 'id-read' },
          { [groupKey('DNS Write', GROUP_SCOPES.zone)]: 'id-write' },
        ],
      );
      assert.equal(bao.seen.length, 1);
    });
  });

  /**
   * ⛔ THE SEVEN LIVE PAIRS, TRANSCRIBED FROM `bao read cloudflare-<account>-platform/
   *   permission-groups` ON 2026-09-15: each name listed twice, one account-scoped id and one
   *   zone-scoped id. Keyed by name this is the failure that stopped the first engine plan; keyed
   *   by (name, scope) each entry asks for the one its resource is gated at.
   */
  const AMBIGUOUS = [
    [
      'Access: Apps and Policies Read',
      '7ea222f6d5064cfa89ea366d7c1fee89',
      'eb258a38ea634c86a0c89da6b27cb6b6',
    ],
    [
      'Access: Apps and Policies Revoke',
      '6c9d1cfcfc6840a987d1b5bfb880a841',
      '6db4e222e21248ac96a3f4c2a81e3b41',
    ],
    [
      'Access: Apps and Policies Write',
      '1e13c5124ca64b72b1969a67e8829049',
      '959972745952452f8be2452be8cbb9f2',
    ],
    ['Disable ESC Read', '29eefa0805f94fdfae2b058b5b52f319', 'e199d584e69344eba202452019deafe3'],
    ['Disable ESC Write', '18555e39c5ba40d284dde87eda845a90', '9110d9dd749e464fb9f3961a2064efc5'],
    ['Logs Read', '6a315a56f18441e59ed03352369ae956', 'c4a30cd58c5d42619c86a3c36c441e2d'],
    ['Logs Write', '96163bd1b0784f62b3e44ed8c2ab1eb6', '3e0b5820118e47f3922f7c989e673882'],
  ] as const;

  const LIVE_SHAPED = [
    ...AMBIGUOUS.flatMap(([name, accountId, zoneId]) => [
      { id: accountId, name, scopes: [GROUP_SCOPES.account] },
      { id: zoneId, name, scopes: [GROUP_SCOPES.zone] },
    ]),
    // The two bucket-scoped groups the pgBackRest role needs, and their account-scoped namesakes.
    {
      id: 'r2-item-read',
      name: 'Workers R2 Storage Bucket Item Read',
      scopes: [GROUP_SCOPES.bucket],
    },
    {
      id: 'r2-item-write',
      name: 'Workers R2 Storage Bucket Item Write',
      scopes: [GROUP_SCOPES.bucket],
    },
    { id: 'r2-read', name: 'Workers R2 Storage Read', scopes: [GROUP_SCOPES.account] },
    ...GROUPS,
  ];

  it('separates the seven two-id names by the scope the asking entry is gated at', async () => {
    await withFake(engine(LIVE_SHAPED), async (bao) => {
      const resolved = await run(
        { BAO_ADDR: bao.address },
        Effect.flatMap(resolveWith(permissionGroupsFromEngine()), (groups) =>
          groups.resolve(MOUNT, [
            ...AMBIGUOUS.map(([name]) => account(name)),
            ...AMBIGUOUS.map(([name]) => zone(name)),
          ]),
        ),
      );
      assert.deepEqual(
        AMBIGUOUS.map(([name]) => [
          resolved.get(groupKey(name, GROUP_SCOPES.account)),
          resolved.get(groupKey(name, GROUP_SCOPES.zone)),
        ]),
        AMBIGUOUS.map(([, accountId, zoneId]) => [accountId, zoneId]),
      );
    });
  });

  /**
   * ⛔ r2-backup-host's ENTRY IS BUCKET-SCOPED (`bucket: example-db-backup`), and the two groups it
   *   names are the only two the account lists at `com.cloudflare.edge.r2.bucket` — MEASURED
   *   2026-09-15: 2 of 399. A unique name still resolves whatever scope asks, which is why the
   *   account-scoped `Workers R2 Storage Read` here answers a bucket-scoped question too.
   */
  it('resolves the bucket-scoped R2 item groups, and a unique name at any scope', async () => {
    await withFake(engine(LIVE_SHAPED), async (bao) => {
      const resolved = await run(
        { BAO_ADDR: bao.address },
        Effect.flatMap(resolveWith(permissionGroupsFromEngine()), (groups) =>
          groups.resolve(MOUNT, [
            bucket('Workers R2 Storage Bucket Item Write'),
            bucket('Workers R2 Storage Bucket Item Read'),
            bucket('Workers R2 Storage Read'),
          ]),
        ),
      );
      assert.deepEqual(Object.fromEntries(resolved), {
        [groupKey('Workers R2 Storage Bucket Item Read', GROUP_SCOPES.bucket)]: 'r2-item-read',
        [groupKey('Workers R2 Storage Bucket Item Write', GROUP_SCOPES.bucket)]: 'r2-item-write',
        [groupKey('Workers R2 Storage Read', GROUP_SCOPES.bucket)]: 'r2-read',
      });
    });
  });

  /** ⛔ A TWO-ID NAME ASKED AT A SCOPE IT IS NOT LISTED AT IS UNKNOWN, never the other id. */
  it('fails a two-id name at a scope neither of its ids carries', async () => {
    await withFake(engine(LIVE_SHAPED), async (bao) => {
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromEngine(), (groups) =>
          groups.resolve(MOUNT, [bucket('Logs Write')]),
        ),
      );
      assert.match(
        String(error),
        /unknown group "Logs Write" at scope com\.cloudflare\.edge\.r2\.bucket/,
      );
    });
  });

  it('fails an unknown name rather than dropping it', async () => {
    await withFake(engine(GROUPS), async (bao) => {
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromEngine(), (groups) =>
          groups.resolve(MOUNT, [zone('DNS Reed')]),
        ),
      );
      assert.ok(error instanceof CloudflareGroupsError);
      assert.match(error.message, /unknown group "DNS Reed"/);
    });
  });

  /**
   * ⛔ THE FAILURE EVERY PLAN HITS UNTIL THE OPERATOR DEPLOYS THE GRANT. A bare `403: permission
   *   denied` names the path and nothing to do about it; this asserts the message carries the
   *   stanza and the file, because that is the whole difference between a five-minute fix and a
   *   re-investigation of a deployed, working endpoint.
   */
  it('names the missing policy grant on 403, not a bare permission denied', async () => {
    await withFake(
      () => ({ json: { errors: ['permission denied'] }, status: 403 }),
      async (bao) => {
        const error = await runFailure(
          { BAO_ADDR: bao.address },
          Effect.flatMap(permissionGroupsFromEngine(), (groups) =>
            groups.resolve(MOUNT, [zone('DNS Read')]),
          ),
        );
        assert.ok(error instanceof CloudflareGroupsError);
        assert.match(error.message, /answered 403/);
        assert.match(
          error.message,
          /path "cloudflare-acme-dns\/permission-groups" \{ capabilities = \["read"\] \}/,
        );
        assert.match(error.message, /20-cloudflare-permission-groups\.hcl/);
      },
    );
  });

  it('fails when the endpoint is not deployed (404), never reading it as no groups', async () => {
    await withFake(
      () => ({ json: { errors: [] }, status: 404 }),
      async (bao) => {
        const error = await runFailure(
          { BAO_ADDR: bao.address },
          Effect.flatMap(permissionGroupsFromEngine(), (groups) =>
            groups.resolve(MOUNT, [zone('DNS Read')]),
          ),
        );
        assert.match(String(error), /not deployed/);
      },
    );
  });

  /**
   * ⛔ TWO IDS SHARING ONE SCOPE IS STILL AMBIGUOUS, and fails the whole mount rather than the one
   *   role — the scope is the only thing that can tell a name's ids apart, and here it does not.
   */
  it('fails a name listed with two ids at the same scope', async () => {
    await withFake(
      engine([...GROUPS, { id: 'id-other', name: 'DNS Read', scopes: [GROUP_SCOPES.zone] }]),
      async (bao) => {
        const error = await runFailure(
          { BAO_ADDR: bao.address },
          Effect.flatMap(permissionGroupsFromEngine(), (groups) =>
            groups.resolve(MOUNT, [zone('DNS Write')]),
          ),
        );
        assert.match(
          String(error),
          /ambiguous: "DNS Read" is listed with two ids at scope com\.cloudflare\.api\.account\.zone/,
        );
      },
    );
  });
});

const ZONE = 'com.cloudflare.api.account.zone.z1';

const declared = (mount: string, name: string, groups: string[]): ExpandedRole => ({
  account: 'acme',
  accountId: 'acct',
  catalog: { description: '', maxTtl: '1h', permissions: groups, ttl: '5m', zone: 'example.com' },
  description: '',
  maxTtl: '1h',
  mount,
  name,
  policies: [{ effect: 'allow', groupOrder: 'declared', groups, resource: ZONE }],
  surface: mount.split('-').at(-1) ?? '',
  ttl: '5m',
});

/** Live roles, keyed by API path; everything else is a 404. */
const liveRoles =
  (roles: Record<string, string[]>) =>
  (seen: Seen): Reply => {
    const ids = roles[seen.path];
    if (ids === undefined) return { json: { errors: [] }, status: 404 };
    const policies = JSON.stringify([
      { effect: 'allow', resources: { [ZONE]: '*' }, permission_groups: ids.map((id) => ({ id })) },
    ]);
    return {
      json: { data: { description: '', max_ttl: 3600, name: 'x', policies, ttl: 300 } },
      status: 200,
    };
  };

/**
 * One account, two mounts. `Email Routing` is isolated only by combining them — the shape that
 * made source (b) per account rather than per mount.
 */
const DECLARED = new Map([
  [MOUNT, [declared(MOUNT, 'dns-read', ['DNS Read'])]],
  [
    'cloudflare-acme-platform',
    [declared('cloudflare-acme-platform', 'create', ['DNS Read', 'Email Routing'])],
  ],
]);

describe('permissionGroupsFromLiveRoles', () => {
  const LIVE = {
    '/v1/cloudflare-acme-dns/roles/dns-read': ['id-read'],
    '/v1/cloudflare-acme-platform/roles/create': ['id-email', 'id-read'],
  };

  it('resolves a name only a sibling mount of the same account can isolate', async () => {
    await withFake(liveRoles(LIVE), async (bao) => {
      const groups = await run(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromLiveRoles(DECLARED), (source) =>
          source.resolve('cloudflare-acme-platform', [zone('Email Routing'), zone('DNS Read')]),
        ),
      );
      assert.deepEqual(Object.fromEntries(groups), {
        [groupKey('DNS Read', GROUP_SCOPES.zone)]: 'id-read',
        [groupKey('Email Routing', GROUP_SCOPES.zone)]: 'id-email',
      });
    });
  });

  it('fails a name no live role carries — a new group needs the engine endpoint', async () => {
    await withFake(liveRoles(LIVE), async (bao) => {
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromLiveRoles(DECLARED), (source) =>
          source.resolve(MOUNT, [zone('Zone WAF Write')]),
        ),
      );
      assert.ok(error instanceof CloudflareGroupsError);
      assert.match(error.message, /unknown group "Zone WAF Write".*engine endpoint/);
    });
  });

  it('fails the whole account when a live role contradicts the rest', async () => {
    const contradicted = { ...LIVE, '/v1/cloudflare-acme-dns/roles/dns-read': ['id-write'] };
    await withFake(liveRoles(contradicted), async (bao) => {
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromLiveRoles(DECLARED), (source) =>
          source.resolve(MOUNT, [zone('DNS Read')]),
        ),
      );
      // dns-read now teaches `DNS Read` → id-write, and `create` carries id-read instead.
      assert.match(
        String(error),
        /account acme: .*contradicted: cloudflare-acme-platform\/create\[0\] declares "DNS Read" but lacks its id id-write/,
      );
    });
  });

  it('fails a mount nothing is declared on', async () => {
    await withFake(liveRoles(LIVE), async (bao) => {
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        Effect.flatMap(permissionGroupsFromLiveRoles(DECLARED), (source) =>
          source.resolve('cloudflare-acme-security', [zone('DNS Read')]),
        ),
      );
      assert.match(String(error), /no declared role on this mount/);
    });
  });
});
