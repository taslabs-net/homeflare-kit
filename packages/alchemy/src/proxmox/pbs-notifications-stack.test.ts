/**
 * A target and the matcher that routes to it, declared together the way docs/pbs-notifications.md
 * shows — with the matcher naming the target through its OUTPUT, not a string.
 *
 * ★ WHY THE OUTPUT: PBS refuses to create a matcher naming a target that does not exist, and
 *   refuses to delete a target a matcher still names. `targets: [hook.name]` gives Alchemy the
 *   dependency edge that orders both; a bare `'alertmanager'` string gives it nothing, and the
 *   order is then whatever the engine picks. This pins that the Output resolves inside the list
 *   (the matcher's `isResolved` guard) and that the target is written first.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { alertmanagerAlertBody } from './alertmanager-body.ts';
import type { PbsTarget } from './credentials.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { withoutBao } from './fake-pve.ts';
import {
  PbsNotificationMatcher,
  PbsNotificationMatcherProvider,
} from './pbs-notification-matcher.ts';
import { PbsNotificationTarget, PbsNotificationTargetProvider } from './pbs-notification-target.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };

const stack = Effect.gen(function* () {
  const hook = yield* PbsNotificationTarget('alertmanager', {
    body: alertmanagerAlertBody(),
    header: { 'Content-Type': 'application/json' },
    method: 'post',
    name: 'alertmanager',
    target: PBS,
    type: 'webhook',
    url: 'https://alertmanager.example.com/api/v2/alerts',
  });
  yield* PbsNotificationMatcher('page-on-failure', {
    'match-field': ['exact:type=gc,prune,sync,verify'],
    'match-severity': ['error'],
    name: 'page-on-failure',
    target: PBS,
    targets: [hook.name],
  });
});

test('the matcher resolves the target by Output and is written after it', async () => {
  const fake = fakeNotify();
  const providers = Layer.mergeAll(
    PbsNotificationTargetProvider(),
    PbsNotificationMatcherProvider(),
  );
  await withoutBao(async () => {
    const engine = engineOver(providers.pipe(Layer.provideMerge(fake.layer)));
    await engine.deploy(stack);
    const again = await engine.verify(stack, { all: true });
    expect(again.rows.map((row) => row.diff)).toEqual(['noop', 'noop']);
  });
  expect(fake.writes()).toEqual([
    'POST config/notifications/endpoints/webhook',
    'POST config/notifications/matchers',
  ]);
  expect(fake.objects.get('config/notifications/matchers/page-on-failure')?.['target']).toEqual([
    'alertmanager',
  ]);
});

test('a new type under the same name replaces delete-first — names are unique across families', async () => {
  const fake = fakeNotify();
  const declare = (type: 'sendmail' | 'webhook') =>
    type === 'webhook'
      ? PbsNotificationTarget('pager', {
          method: 'post',
          name: 'pager',
          target: PBS,
          type,
          url: 'https://alertmanager.example.com/api/v2/alerts',
        })
      : PbsNotificationTarget('pager', {
          mailto: ['ops@example.com'],
          name: 'pager',
          target: PBS,
          type,
        });
  await withoutBao(async () => {
    const engine = engineOver(PbsNotificationTargetProvider().pipe(Layer.provideMerge(fake.layer)));
    await engine.deploy(declare('webhook'));
    await engine.deploy(declare('sendmail'));
  });
  expect(fake.writes()).toEqual([
    'POST config/notifications/endpoints/webhook',
    'DELETE config/notifications/endpoints/webhook/pager',
    'POST config/notifications/endpoints/sendmail',
  ]);
});

test('renaming a matcher replaces it instead of leaving the old route behind', async () => {
  const fake = fakeNotify();
  const declare = (name: string) =>
    PbsNotificationMatcher('route', {
      name,
      target: PBS,
      targets: ['mail-to-root'],
    });
  await withoutBao(async () => {
    const engine = engineOver(
      PbsNotificationMatcherProvider().pipe(Layer.provideMerge(fake.layer)),
    );
    await engine.deploy(declare('route-old'));
    await engine.deploy(declare('route-new'));
    expect((await engine.verify(declare('route-new'), { all: true })).rows[0]?.diff).toBe('noop');
  });
  expect(fake.objects.has('config/notifications/matchers/route-old')).toBe(false);
  expect(fake.objects.has('config/notifications/matchers/route-new')).toBe(true);
  expect(fake.writes()).toEqual([
    'POST config/notifications/matchers',
    'POST config/notifications/matchers',
    'DELETE config/notifications/matchers/route-old',
  ]);
});
