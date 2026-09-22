/**
 * The bootstrap solver — ⚠️ temporary, like the code it tests. Resolvable by single-group pairs and
 * by elimination; ambiguous in both directions; unresolved when nothing isolates a name;
 * contradicted when an entry declares a known name without its id; and never a pair inferred from
 * position. Unknown names at lookup time are in cloudflare-permission-groups.test.ts, because that
 * is where a lookup happens.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Observation,
  describeProblems,
  observationsOf,
  solveGroups,
} from './cloudflare-permission-groups-solve.ts';
import type { WirePolicy } from './cloudflare-policy.ts';
import type { ExpandedRole } from './cloudflare-roles-expand.ts';

const obs = (where: string, names: string[], ids: string[]): Observation => ({ ids, names, where });

describe('solveGroups', () => {
  it('pairs single-group entries, then eliminates known pairs until nothing changes', () => {
    const solved = solveGroups([
      // Out of order on purpose: the chain below needs two passes to settle.
      obs('platform/union', ['Email Routing', 'Queues Write'], ['id-queues', 'id-email']),
      obs(
        'platform/create[0]',
        ['DNS Write', 'Email Routing', 'DNS Read'],
        ['id-email', 'id-read', 'id-write'],
      ),
      obs('dns/read', ['DNS Read'], ['id-read']),
      obs('dns/edit', ['DNS Write'], ['id-write']),
    ]);
    assert.deepEqual(Object.fromEntries(solved.groups), {
      'DNS Read': 'id-read',
      'DNS Write': 'id-write',
      'Email Routing': 'id-email',
      'Queues Write': 'id-queues',
    });
    assert.deepEqual([solved.ambiguous, solved.unresolved, solved.contradicted], [[], [], []]);
  });

  // ⛔ The Python kept yaml order in a declared entry, and it would have paired these correctly.
  //    A hand-edited role would pair them wrongly with the same confidence, so position is never used.
  it('never pairs by position', () => {
    const solved = solveGroups([
      obs('platform/run', ['AI Gateway Read', 'AI Gateway Run'], ['a', 'b']),
    ]);
    assert.equal(solved.groups.size, 0);
    assert.deepEqual(solved.unresolved, ['AI Gateway Read', 'AI Gateway Run']);
  });

  it('reports a name bound to two ids as ambiguous and keeps it out of the map', () => {
    const solved = solveGroups([
      obs('dns/a-dns-read', ['DNS Read'], ['id-read']),
      obs('dns/b-dns-read', ['DNS Read'], ['id-write']),
    ]);
    assert.equal(solved.groups.has('DNS Read'), false);
    assert.deepEqual(solved.ambiguous, [
      { bound: ['id-read', 'id-write'], kind: 'name', value: 'DNS Read' },
    ]);
    assert.match(describeProblems(solved)[0] ?? '', /^ambiguous: name "DNS Read" is bound to ids/);
  });

  it('reports an id bound to two names as ambiguous', () => {
    const solved = solveGroups([
      obs('dns/edit', ['DNS Write'], ['id-1']),
      obs('dns/also-edit', ['Zone DNS Write'], ['id-1']),
    ]);
    assert.equal(solved.groups.size, 0);
    assert.deepEqual(solved.ambiguous, [
      { bound: ['DNS Write', 'Zone DNS Write'], kind: 'id', value: 'id-1' },
    ]);
  });

  // ⚠️ A contradicting single-group role must surface even when its name was already learned.
  it('records a contradicting single-group entry wherever it sits', () => {
    const solved = solveGroups([
      obs('dns/x', ['DNS Read'], ['id-read']),
      obs('dns/union', ['DNS Read', 'Cache Purge'], ['id-read', 'id-purge']),
      obs('dns/hand-edited', ['DNS Read'], ['id-other']),
    ]);
    assert.equal(solved.ambiguous.length, 1);
    assert.equal(solved.groups.has('DNS Read'), false);
  });

  it('binds nothing from an entry that contradicts what is known, and reports it', () => {
    const solved = solveGroups([
      obs('dns/read', ['A'], ['a']),
      obs('platform/drifted', ['A', 'B'], ['x', 'y']),
    ]);
    assert.deepEqual(solved.unresolved, ['B']);
    assert.deepEqual(solved.contradicted, [{ id: 'a', name: 'A', where: 'platform/drifted' }]);
  });

  // ⛔ THE BUG THIS CHECK EXISTS FOR. `workers-deploy` is the only single-group witness of its
  //    group on an account. Edited by hand, it teaches the map the edited id, and without this every
  //    union role carrying the real id would plan an update TO the edited one.
  it('reports every entry that contradicts a hand-edited sole witness', () => {
    const solved = solveGroups([
      obs('platform/workers-deploy', ['Scripts Write'], ['id-edited']),
      obs('platform/containers', ['Containers Write'], ['id-containers']),
      obs(
        'platform/workers-deploy-containers',
        ['Scripts Write', 'Containers Write'],
        ['id-containers', 'id-scripts'],
      ),
    ]);
    assert.deepEqual(solved.contradicted, [
      { id: 'id-edited', name: 'Scripts Write', where: 'platform/workers-deploy-containers' },
    ]);
    assert.match(
      describeProblems(solved).at(-1) ?? '',
      /^contradicted: platform\/workers-deploy-containers declares "Scripts Write" but lacks its id id-edited$/,
    );
  });

  it('skips an entry whose name and id counts differ, without calling it a contradiction', () => {
    const solved = solveGroups([
      obs('dns/read', ['A'], ['a']),
      obs('dns/short', ['A', 'B'], ['a']),
    ]);
    assert.deepEqual([solved.unresolved, solved.contradicted], [['B'], []]);
    assert.match(describeProblems(solved)[0] ?? '', /^unresolved: no live role isolates "B"/);
  });
});

const ZONE = 'com.cloudflare.api.account.zone.z1';
const ACCOUNT = 'com.cloudflare.api.account.acct';

const declaredRole: ExpandedRole = {
  account: 'acme',
  accountId: 'acct',
  catalog: { description: '', maxTtl: '1h', permissions: [], ttl: '5m', zone: 'example.com' },
  description: ' (zone: example.com)',
  maxTtl: '1h',
  mount: 'cloudflare-acme-platform',
  name: 'example-com-create',
  policies: [
    { effect: 'allow', groupOrder: 'declared', groups: ['Routes'], resource: ZONE },
    { effect: 'allow', groupOrder: 'by-id', groups: ['Scripts', 'Queues'], resource: ACCOUNT },
  ],
  surface: 'platform',
  ttl: '5m',
};

describe('observationsOf', () => {
  it('pairs declared and live entries by resource, whatever order live stored them in', () => {
    const live = new Map<string, readonly WirePolicy[]>([
      [
        'cloudflare-acme-platform/example-com-create',
        [
          { effect: 'allow', groupIds: ['q', 's'], resources: { [ACCOUNT]: '*' } },
          { effect: 'allow', groupIds: ['r'], resources: { [ZONE]: '*' } },
        ],
      ],
    ]);
    assert.deepEqual(observationsOf([declaredRole], live), [
      { ids: ['r'], names: ['Routes'], where: 'cloudflare-acme-platform/example-com-create[0]' },
      {
        ids: ['q', 's'],
        names: ['Scripts', 'Queues'],
        where: 'cloudflare-acme-platform/example-com-create[1]',
      },
    ]);
  });

  it('observes nothing for a role that is not live', () => {
    assert.deepEqual(observationsOf([declaredRole], new Map()), []);
  });
});
