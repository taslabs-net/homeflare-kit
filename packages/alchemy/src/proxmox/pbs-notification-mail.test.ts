/** Mail target CRUD uses the SDK's field spellings without losing lists or the password seal. */
import { afterEach, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { withoutBao } from './fake-pve.ts';
import { PbsNotificationTarget, PbsNotificationTargetProvider } from './pbs-notification-target.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007', mount: 'pbs-test', scheme: 'pbs' };
const PASSWORD = 'smtp-test-secret-not-real';
afterEach(() => {
  delete process.env['HF_PBS_SMTP_TEST_PASSWORD'];
});

for (const type of ['sendmail', 'smtp'] as const) {
  test(`${type} creates, reads its dashed fields, clears recipients and redeploys without a write`, async () => {
    process.env['HF_PBS_SMTP_TEST_PASSWORD'] = PASSWORD;
    const fake = fakeNotify();
    const declare = (mailto: readonly string[]) =>
      PbsNotificationTarget('pager', {
        type,
        name: 'pager',
        target: PBS,
        'from-address': 'sender@example.com',
        'mailto-user': ['root@pam'],
        mailto,
        ...(type === 'smtp'
          ? {
              mode: 'starttls' as const,
              password: { fromEnv: 'HF_PBS_SMTP_TEST_PASSWORD' },
              port: 587,
              server: 'smtp.example.com',
              username: 'pager',
            }
          : {}),
      });
    await withoutBao(async () => {
      const engine = engineOver(
        PbsNotificationTargetProvider().pipe(Layer.provideMerge(fake.layer)),
      );
      await engine.deploy(declare(['ops@example.com', 'backup@example.com']));
      expect(
        (await engine.verify(declare(['ops@example.com', 'backup@example.com']), { all: true }))
          .rows[0]?.diff,
      ).toBe('noop');
      expect(engine.stored()).not.toContain(PASSWORD);
      await engine.deploy(declare([]));
      expect((await engine.verify(declare([]), { all: true })).rows[0]?.diff).toBe('noop');
      await engine.deploy(declare([]));
    });
    expect(fake.writes()).toEqual([
      `POST config/notifications/endpoints/${type}`,
      `PUT config/notifications/endpoints/${type}/pager`,
    ]);
    const post = fake.calls.find((call) => call.method === 'POST');
    expect(post?.pairs).toContainEqual(['from-address', 'sender@example.com']);
    expect(post?.pairs).toContainEqual(['mailto-user', 'root@pam']);
    expect(post?.pairs.filter(([key]) => key === 'mailto')).toHaveLength(2);
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.pairs).toContainEqual(['delete', 'mailto']);
    expect(put?.pairs.map(([key]) => key)).not.toContain('password');
  });
}
