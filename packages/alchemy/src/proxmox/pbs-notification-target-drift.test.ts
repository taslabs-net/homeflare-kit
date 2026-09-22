/**
 * `Pbs.NotificationTarget` drift that is not about a secret's VALUE: a target switched off by hand,
 * and a secret NAME added to the declaration. Split from pbs-notification-target-state.test.ts for
 * the 250-line cap; the same fake server (fake-pbs-notify.ts) and the same engine.
 *
 * ★ BOTH WERE FOUND BY MUTATION, NOT BY READING. Deleting the `disable` line from `plainMatches`, or
 *   the secret-name line from `sealedState`, left every other test green: nothing had declared a
 *   target, changed it on the server, and asked the plan.
 */
import { afterEach, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { withoutBao } from './fake-pve.ts';
import {
  PbsNotificationTarget,
  type PbsNotificationTargetProps,
  PbsNotificationTargetProvider,
} from './pbs-notification-target.ts';
import { keyAndValue } from './pbs-notification-target-wire.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const PATH = 'config/notifications/endpoints/webhook/alertmanager';

const hook = (over: Partial<PbsNotificationTargetProps> = {}) =>
  PbsNotificationTarget('alertmanager', {
    method: 'post',
    name: 'alertmanager',
    secret: { token: { fromEnv: 'HF_DRIFT_TOKEN' } },
    target: PBS,
    type: 'webhook',
    url: 'https://alertmanager.example.com/api/v2/alerts',
    ...over,
  });

afterEach(() => {
  delete process.env['HF_DRIFT_TOKEN'];
  delete process.env['HF_DRIFT_ROUTE'];
});

const engineFor = (fake: ReturnType<typeof fakeNotify>) =>
  engineOver(PbsNotificationTargetProvider().pipe(Layer.provideMerge(fake.layer)));

test('a target disabled by hand plans an update, and the deploy switches it back on', async () => {
  process.env['HF_DRIFT_TOKEN'] = 'tok-drift-not-real';
  const fake = fakeNotify();
  await withoutBao(async () => {
    const engine = engineFor(fake);
    await engine.deploy(hook());
    fake.objects.set(PATH, { ...fake.objects.get(PATH), disable: true });
    expect((await engine.verify(hook(), { all: true })).rows[0]?.diff).toBe('update');
    await engine.deploy(hook());
  });
  const put = fake.calls.find((call) => call.method === 'PUT');
  expect(put?.pairs).toContainEqual(['disable', '0']);
  expect(put?.pairs.map(([key]) => key)).not.toContain('secret');
  expect(fake.objects.get(PATH)?.['disable']).toBe(false);
});

test('a secret name added is stale by PRESENCE — seen with no variables set — and both are sent', async () => {
  process.env['HF_DRIFT_TOKEN'] = 'tok-drift-not-real';
  const fake = fakeNotify();
  const twoSecrets = () =>
    hook({
      secret: { route: { fromEnv: 'HF_DRIFT_ROUTE' }, token: { fromEnv: 'HF_DRIFT_TOKEN' } },
    });
  await withoutBao(async () => {
    const engine = engineFor(fake);
    await engine.deploy(hook());
    // ⚠️ No variable at plan time, so the seal cannot be checked: only the names can say this.
    delete process.env['HF_DRIFT_TOKEN'];
    expect((await engine.verify(twoSecrets(), { all: true })).rows[0]?.diff).toBe('update');
    process.env['HF_DRIFT_TOKEN'] = 'tok-drift-not-real';
    process.env['HF_DRIFT_ROUTE'] = 'route-not-real';
    await engine.deploy(twoSecrets());
    expect(engine.stored()).not.toContain('route-not-real');
  });
  expect((fake.secrets.get(PATH) ?? []).map((item) => keyAndValue(item).name).sort()).toEqual([
    'route',
    'token',
  ]);
});
