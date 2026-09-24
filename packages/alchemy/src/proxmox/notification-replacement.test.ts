/** Real Plan/Apply must refuse an invalid replacement before deleting its working target. */
import { afterEach, beforeEach, expect } from 'bun:test';
import * as Test from 'alchemy/Test/Bun';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { fakeNotify } from './fake-pbs-notify.ts';
import { FAKE_TARGET, fakePve } from './fake-pve.ts';
import {
  type NotificationTargetProps,
  ProxmoxNotificationTarget,
  ProxmoxNotificationTargetProvider,
} from './notification-target.ts';
import {
  PbsNotificationTarget,
  type PbsNotificationTargetProps,
  PbsNotificationTargetProvider,
} from './pbs-notification-target.ts';

const MISSING = 'HF_NOTIFICATION_REPLACEMENT_MISSING';
const PBS = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' } as const;
const fake = fakeNotify();
let saved: [string, string | undefined][] = [];
beforeEach(() => {
  saved = Object.entries(process.env).filter(
    ([key]) => /^(BAO|VAULT)_/.test(key) || key === MISSING,
  );
  for (const [key] of saved) delete process.env[key];
  process.env['BAO_ADDR'] = 'http://bao.invalid';
  fake.objects.clear();
  fake.secrets.clear();
  fake.calls.length = 0;
});
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (/^(BAO|VAULT)_/.test(key) || key === MISSING) delete process.env[key];
  for (const [key, value] of saved) process.env[key] = value;
});
const { test } = Test.make({
  adopt: true,
  dev: false,
  sidecar: false,
  stage: 'test',
  providers: Layer.mergeAll(
    ProxmoxNotificationTargetProvider(),
    PbsNotificationTargetProvider(),
  ).pipe(Layer.provideMerge(fake.layer)),
});

const pve = (props: Omit<NotificationTargetProps, 'target'>) =>
  ProxmoxNotificationTarget('endpoint', { ...props, target: FAKE_TARGET });
const pbs = (props: Omit<PbsNotificationTargetProps, 'target'>) =>
  PbsNotificationTarget('endpoint', { ...props, target: PBS });
const invalidPve: readonly Omit<NotificationTargetProps, 'target' | 'name'>[] = [
  { type: 'webhook', method: 'post' },
  { type: 'gotify', server: 'https://gotify.example.com' },
  { type: 'smtp', server: 'smtp.example.com' },
  {
    type: 'webhook',
    method: 'post',
    url: 'https://pager.example.com',
    mailto: ['ops@example.com'],
  },
];
const invalidPbs: readonly Omit<PbsNotificationTargetProps, 'target' | 'name'>[] = [
  { type: 'webhook', method: 'post' },
  {
    type: 'webhook',
    method: 'post',
    url: 'https://pager.example.com',
    secret: { token: { fromEnv: MISSING } },
  },
  { type: 'webhook', method: 'post', url: 'https://pager.example.com', comment: 'x'.repeat(129) },
];
for (const [index, props] of invalidPve.entries()) {
  test.provider(`PVE replacement refusal ${index} preserves the old target`, (scratch) =>
    Effect.gen(function* () {
      const old = pve({ name: 'pager', type: 'sendmail' });
      yield* scratch.deploy(old);
      const path = 'cluster/notifications/endpoints/sendmail/pager';
      const before = fake.objects.get(path);
      fake.calls.length = 0;
      expect((yield* Effect.exit(scratch.deploy(pve({ ...props, name: 'pager' }))))._tag).toBe(
        'Failure',
      );
      expect(fake.writes()).toEqual([]);
      expect(fake.objects.get(path)).toEqual(before);
      expect(Object.values((yield* scratch.plan(old)).resources).map((row) => row.action)).toEqual([
        'noop',
      ]);
    }),
  );
}
for (const [index, props] of invalidPbs.entries()) {
  test.provider(`PBS replacement refusal ${index} preserves the old target`, (scratch) =>
    Effect.gen(function* () {
      const old = pbs({ name: 'pager', type: 'sendmail' });
      yield* scratch.deploy(old);
      const path = 'config/notifications/endpoints/sendmail/pager';
      const before = fake.objects.get(path);
      fake.calls.length = 0;
      expect((yield* Effect.exit(scratch.deploy(pbs({ ...props, name: 'pager' }))))._tag).toBe(
        'Failure',
      );
      expect(fake.writes()).toEqual([]);
      expect(fake.objects.get(path)).toEqual(before);
      expect(Object.values((yield* scratch.plan(old)).resources).map((row) => row.action)).toEqual([
        'noop',
      ]);
    }),
  );
}
test.provider(
  'PVE can replace by adopting an existing renamed gotify target without its token',
  (scratch) =>
    Effect.gen(function* () {
      yield* scratch.deploy(pve({ name: 'old', type: 'sendmail' }));
      const path = 'cluster/notifications/endpoints/gotify/existing';
      fake.objects.set(path, { name: 'existing', server: 'https://gotify.example.com' });
      fake.calls.length = 0;
      yield* scratch.deploy(
        pve({ name: 'existing', type: 'gotify', server: 'https://gotify.example.com' }),
      );
      expect(fake.objects.has(path)).toBe(true);
      expect(fake.writes()).toEqual(['DELETE cluster/notifications/endpoints/sendmail/old']);
    }),
);

const forbidden = fakePve((call) =>
  call.path.endsWith('/sendmail/pager')
    ? { name: 'pager' }
    : Response.json({ message: 'forbidden' }, { status: 403 }),
);
const blocked = Test.make({
  adopt: true,
  dev: false,
  sidecar: false,
  stage: 'test',
  providers: Layer.mergeAll(
    ProxmoxNotificationTargetProvider(),
    PbsNotificationTargetProvider(),
  ).pipe(Layer.provideMerge(forbidden.layer)),
}).test;
for (const declare of [pve, pbs]) {
  blocked.provider(`${declare.name} destination refusal prevents replacement deletion`, (scratch) =>
    Effect.gen(function* () {
      forbidden.calls.length = 0;
      yield* scratch.deploy(declare({ name: 'pager', type: 'sendmail' }));
      const replacement = declare({
        name: 'pager',
        type: 'webhook',
        url: 'https://pager.example.com',
        method: 'post',
      });
      expect((yield* Effect.exit(scratch.deploy(replacement)))._tag).toBe('Failure');
      expect(forbidden.writes()).toEqual([]);
    }),
  );
}
test.provider(
  'PBS can replace by adopting an existing renamed webhook without its secret value',
  (scratch) =>
    Effect.gen(function* () {
      yield* scratch.deploy(pbs({ name: 'old', type: 'sendmail' }));
      const path = 'config/notifications/endpoints/webhook/existing';
      fake.objects.set(path, {
        name: 'existing',
        url: 'https://pager.example.com',
        method: 'post',
        secret: ['name=token'],
      });
      fake.calls.length = 0;
      yield* scratch.deploy(
        pbs({
          name: 'existing',
          type: 'webhook',
          url: 'https://pager.example.com',
          method: 'post',
          secret: { token: { fromEnv: MISSING } },
        }),
      );
      expect(fake.objects.has(path)).toBe(true);
      expect(fake.writes()).toEqual(['DELETE config/notifications/endpoints/sendmail/old']);
    }),
);
