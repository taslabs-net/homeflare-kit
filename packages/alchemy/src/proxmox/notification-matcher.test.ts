/**
 * `Proxmox.NotificationMatcher` and `Pbs.NotificationMatcher` — forms against the generated
 * schemas, the canonical spellings, and both built-in `default-matcher`s adopted as they are.
 *
 * ★ THE LIVE FIXTURES ARE THE MEASURED ONES (2026-09-22): PVE 9.2.11 `pvesh get
 *   /cluster/notifications/matchers/default-matcher` and PBS 4.2 `proxmox-backup-manager
 *   notification matcher show default-matcher`, comment text shortened.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import type {
  ClusterNotificationsMatchersNamePutParams,
  ClusterNotificationsMatchersPostParams,
} from './generated/pve.ts';
import type {
  ConfigNotificationsMatchersNamePutParams,
  ConfigNotificationsMatchersPostParams,
} from './generated/pbs.ts';
import {
  ProxmoxNotificationMatcher,
  ProxmoxNotificationMatcherProvider,
} from './notification-matcher.ts';
import {
  type NotificationMatcherFields,
  matcherAttributes,
  matcherCreateForm,
  matcherMatches,
  matcherUpdateForm,
} from './notification-matcher-form.ts';
import {
  PbsNotificationMatcher,
  PbsNotificationMatcherProvider,
} from './pbs-notification-matcher.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const PVE_PATH = 'cluster/notifications/matchers/default-matcher';
const PBS_PATH = 'config/notifications/matchers/default-matcher';

const PVE_DEFAULT = {
  comment: 'Route all notifications to mail-to-root',
  mode: 'all',
  name: 'default-matcher',
  origin: 'builtin',
  target: ['mail-to-root'],
};
const PBS_DEFAULT = {
  comment: 'Route everything but successful prune jobs',
  'invert-match': true,
  'match-field': ['exact:type=prune'],
  'match-severity': ['info'],
  mode: 'all',
  name: 'default-matcher',
  origin: 'builtin',
  target: ['mail-to-root'],
};

const pbsDefault = (over: Partial<NotificationMatcherFields> = {}) =>
  PbsNotificationMatcher('default-matcher', {
    'invert-match': true,
    'match-field': ['exact:type=prune'],
    'match-severity': ['info'],
    name: 'default-matcher',
    target: PBS,
    targets: ['mail-to-root'],
    ...over,
  });

describe('forms are typed against BOTH generated schemas', () => {
  const fields: NotificationMatcherFields = {
    'match-severity': ['error'],
    name: 'pager',
    targets: ['hook'],
  };

  test('create and update assign to PVE and PBS params without a cast', () => {
    const pveCreate: ClusterNotificationsMatchersPostParams = matcherCreateForm(fields);
    const pbsCreate: ConfigNotificationsMatchersPostParams = matcherCreateForm(fields);
    const pveUpdate: ClusterNotificationsMatchersNamePutParams = matcherUpdateForm(fields);
    const pbsUpdate: ConfigNotificationsMatchersNamePutParams = matcherUpdateForm(fields);
    expect(pveCreate).toEqual(pbsCreate);
    expect(pveUpdate).toEqual(pbsUpdate);
  });

  test('would fail tsc if `name` were dropped from a create', () => {
    // @ts-expect-error name is required on POST .../matchers
    const bad: ConfigNotificationsMatchersPostParams = { target: ['hook'] };
    expect('name' in bad).toBe(false);
  });

  test('create sends lists as lists and the three always-compared flags', () => {
    expect(matcherCreateForm(fields)).toEqual({
      disable: '0',
      'invert-match': '0',
      'match-severity': ['error'],
      mode: 'all',
      name: 'pager',
      target: ['hook'],
    });
  });

  test('update clears every emptied rule list with `delete`, and an empty comment too', () => {
    expect(matcherUpdateForm({ ...fields, comment: '', 'match-severity': [] })).toEqual({
      delete: ['match-calendar', 'match-field', 'match-severity', 'comment'],
      disable: '0',
      'invert-match': '0',
      mode: 'all',
      target: ['hook'],
    });
  });
});

describe('matches reads both sides in the server spelling', () => {
  const live = matcherAttributes(
    {
      'match-field': ['exact:type=gc,verify'],
      'match-severity': ['error,warning'],
      target: ['b', 'a'],
    },
    'm',
  );
  const base: NotificationMatcherFields = { name: 'm', targets: ['a', 'b'] };

  test('spaces after commas and list order are not a diff; absent mode is `all`', () => {
    expect(
      matcherMatches(live, {
        ...base,
        'match-field': ['exact:type=gc, verify'],
        'match-severity': ['warning, error'],
        mode: 'all',
      }),
    ).toBe(true);
  });

  test('an undeclared rule is compared as empty — a matcher is its whole rule', () => {
    expect(matcherMatches(live, { ...base, 'match-severity': ['error,warning'] })).toBe(false);
  });

  test('invert-match, mode and disable are compared against their defaults', () => {
    const rules = { 'match-field': ['exact:type=gc,verify'], 'match-severity': ['error,warning'] };
    expect(matcherMatches(live, { ...base, ...rules })).toBe(true);
    expect(matcherMatches(live, { ...base, ...rules, 'invert-match': true })).toBe(false);
    expect(matcherMatches(live, { ...base, ...rules, mode: 'any' })).toBe(false);
    expect(matcherMatches(live, { ...base, ...rules, disable: true })).toBe(false);
  });
});

describe('adopting a built-in default-matcher as it is only reads', () => {
  test('PVE: target and name, nothing else, is a noop with no write', async () => {
    const fake = fakeNotify({ [PVE_PATH]: PVE_DEFAULT });
    const declare = () =>
      ProxmoxNotificationMatcher('default-matcher', {
        name: 'default-matcher',
        target: FAKE_TARGET,
        targets: ['mail-to-root'],
      });
    await withoutBao(async () => {
      const engine = engineOver(
        ProxmoxNotificationMatcherProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      expect((await engine.verify(declare())).rows).toEqual([
        expect.objectContaining({ diff: 'noop', ok: true }),
      ]);
      expect(Object.values(await engine.deploy(declare()))).toEqual(['adopted']);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('PBS: its three rule fields declared is a noop with no write', async () => {
    const fake = fakeNotify({ [PBS_PATH]: PBS_DEFAULT });
    await withoutBao(async () => {
      const engine = engineOver(
        PbsNotificationMatcherProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      expect((await engine.verify(pbsDefault())).rows).toEqual([
        expect.objectContaining({ diff: 'noop', ok: true }),
      ]);
      await engine.deploy(pbsDefault());
    });
    expect(fake.writes()).toEqual([]);
  });

  test('PBS: leaving the rules out plans an update, and the PUT clears them by name', async () => {
    const fake = fakeNotify({ [PBS_PATH]: PBS_DEFAULT });
    const bare = () =>
      pbsDefault({ 'invert-match': false, 'match-field': [], 'match-severity': [] });
    await withoutBao(async () => {
      const engine = engineOver(
        PbsNotificationMatcherProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      expect((await engine.verify(bare())).rows[0]).toMatchObject({ diff: 'update', ok: false });
      await engine.deploy(bare());
    });
    expect(fake.writes()).toEqual([`PUT ${PBS_PATH}`]);
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.pairs).toContainEqual(['delete', 'match-field']);
    expect(put?.pairs).toContainEqual(['delete', 'match-severity']);
    expect(put?.pairs).toContainEqual(['invert-match', '0']);
    expect(fake.objects.get(PBS_PATH)?.['match-field']).toBeUndefined();
  });

  test('PBS: a new matcher is POSTed with each list item as its own repeated key', async () => {
    const fake = fakeNotify();
    const pager = () =>
      PbsNotificationMatcher('pager', {
        'match-field': ['exact:type=gc,sync,verify'],
        'match-severity': ['error'],
        name: 'pager',
        target: PBS,
        targets: ['alertmanager', 'mail-to-root'],
      });
    await withoutBao(async () => {
      const engine = engineOver(
        PbsNotificationMatcherProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      await engine.deploy(pager());
      expect((await engine.verify(pager(), { all: true })).rows[0]).toMatchObject({ diff: 'noop' });
    });
    const post = fake.calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('config/notifications/matchers');
    expect(post?.pairs.filter(([key]) => key === 'target')).toEqual([
      ['target', 'alertmanager'],
      ['target', 'mail-to-root'],
    ]);
  });
});
