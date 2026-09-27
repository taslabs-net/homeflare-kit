/** Notification lifecycles through the real SDK and upstream Alchemy test harness. */
import { afterEach, beforeEach, expect, test as unit } from 'bun:test';
import * as Test from 'alchemy/Test/Bun';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { fakeNotify } from './fake-pbs-notify.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import {
  ProxmoxNotificationMatcher,
  ProxmoxNotificationMatcherProvider,
} from './notification-matcher.ts';
import {
  ProxmoxNotificationTarget,
  ProxmoxNotificationTargetProvider,
} from './notification-target.ts';
import { readMatcher } from './notification-matcher-distilled.ts';
import { readTarget } from './notification-target-distilled.ts';

const fake = fakeNotify();
let saved: [string, string | undefined][] = [];
beforeEach(() => {
  saved = Object.entries(process.env).filter(([key]) => /^(BAO|VAULT)_/.test(key));
  for (const [key] of saved) delete process.env[key];
  process.env['BAO_ADDR'] = 'http://bao.invalid';
  fake.objects.clear();
  fake.secrets.clear();
  fake.calls.length = 0;
});
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (/^(BAO|VAULT)_/.test(key)) delete process.env[key];
  for (const [key, value] of saved) process.env[key] = value;
});
const { test } = Test.make({
  adopt: true,
  dev: false,
  sidecar: false,
  stage: 'test',
  providers: Layer.mergeAll(
    ProxmoxNotificationTargetProvider(),
    ProxmoxNotificationMatcherProvider(),
  ).pipe(Layer.provideMerge(fake.layer)),
});
const target = (clear = false) =>
  ProxmoxNotificationTarget('mail', {
    target: FAKE_TARGET,
    type: 'sendmail',
    name: 'mail',
    mailto: clear ? [] : ['a@example.com', 'b@example.com'],
    'mailto-user': ['root@pam'],
  });
const matcher = (clear = false) =>
  ProxmoxNotificationMatcher('route', {
    target: FAKE_TARGET,
    name: 'route',
    targets: ['mail'],
    'match-field': clear ? [] : ['exact:type=prune,sync', 'regex:hostname=^node'],
  });
const stack = (clear = false) =>
  Effect.gen(function* () {
    yield* target(clear);
    yield* matcher(clear);
  });
const existing = () => {
  fake.objects.set('cluster/notifications/endpoints/sendmail/mail', {
    name: 'mail',
    mailto: ['b@example.com', 'a@example.com'],
    'mailto-user': ['root@pam'],
  });
  fake.objects.set('cluster/notifications/matchers/route', {
    name: 'route',
    target: ['mail'],
    'match-field': ['exact:type=prune,sync', 'regex:hostname=^node'],
  });
};
const actions = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources)
    .map((row) => row.action)
    .sort();

test.provider('matching target and matcher adopt with zero writes and redeploy noop', (scratch) =>
  Effect.gen(function* () {
    existing();
    yield* scratch.deploy(stack());
    expect(fake.writes()).toEqual([]);
    expect(actions(yield* scratch.plan(stack()))).toEqual(['noop', 'noop']);
  }),
);
test.provider('new rows send repeated arrays and preserve commas inside rules', (scratch) =>
  Effect.gen(function* () {
    yield* scratch.deploy(stack());
    expect(fake.objects.get('cluster/notifications/matchers/route')?.['match-field']).toEqual([
      'exact:type=prune,sync',
      'regex:hostname=^node',
    ]);
    expect(fake.objects.get('cluster/notifications/endpoints/sendmail/mail')?.['mailto']).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(actions(yield* scratch.plan(stack()))).toEqual(['noop', 'noop']);
  }),
);
test.provider('empty recipient and rule arrays clear explicitly and settle to noop', (scratch) =>
  Effect.gen(function* () {
    existing();
    yield* scratch.deploy(stack());
    yield* scratch.deploy(stack(true));
    expect(fake.objects.get('cluster/notifications/endpoints/sendmail/mail')).not.toHaveProperty(
      'mailto',
    );
    expect(fake.objects.get('cluster/notifications/matchers/route')).not.toHaveProperty(
      'match-field',
    );
    expect(actions(yield* scratch.plan(stack(true)))).toEqual(['noop', 'noop']);
  }),
);
for (const status of [200, 400, 401, 403, 500]) {
  unit(`malformed or refused HTTP ${status} cannot become absence`, async () => {
    const broken = fakePve(() => Response.json({ data: null, message: 'refused' }, { status }));
    await withoutBao(async () => {
      const targetRead = readTarget({ target: FAKE_TARGET, name: 'mail', type: 'sendmail' });
      const matcherRead = readMatcher({ target: FAKE_TARGET, name: 'route', targets: ['mail'] });
      expect(
        (await Effect.runPromise(Effect.exit(targetRead).pipe(Effect.provide(broken.layer))))._tag,
      ).toBe('Failure');
      expect(
        (await Effect.runPromise(Effect.exit(matcherRead).pipe(Effect.provide(broken.layer))))._tag,
      ).toBe('Failure');
    });
    expect(broken.writes()).toEqual([]);
  });
}

test.provider('same-name endpoint type changes replace delete-first', (scratch) =>
  Effect.gen(function* () {
    const hook = ProxmoxNotificationTarget('endpoint', {
      target: FAKE_TARGET,
      name: 'pager',
      type: 'webhook',
      url: 'https://pager.example.com',
      method: 'post',
      header: ['name=X-One,value=b25l', 'name=X-Two,value=dHdv'],
    });
    const mail = ProxmoxNotificationTarget('endpoint', {
      target: FAKE_TARGET,
      name: 'pager',
      type: 'sendmail',
      'mailto-user': ['root@pam'],
    });
    yield* scratch.deploy(hook);
    expect(fake.objects.get('cluster/notifications/endpoints/webhook/pager')?.['header']).toEqual([
      'name=X-One,value=b25l',
      'name=X-Two,value=dHdv',
    ]);
    yield* scratch.deploy(mail);
    expect(fake.writes()).toEqual([
      'POST cluster/notifications/endpoints/webhook',
      'DELETE cluster/notifications/endpoints/webhook/pager',
      'POST cluster/notifications/endpoints/sendmail',
    ]);
  }),
);
