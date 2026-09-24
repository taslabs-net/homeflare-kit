/** Read failures must never turn an existing notification route into a planned create. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import { fakePve, withoutBao } from './fake-pve.ts';
import { deleteMatcher, readMatcher } from './pbs-notification-matcher-distilled.ts';
import {
  PbsNotificationMatcher,
  PbsNotificationMatcherProvider,
} from './pbs-notification-matcher.ts';
import { createTarget, deleteTarget, readTarget } from './pbs-notification-target-distilled.ts';
import { PbsNotificationTarget, PbsNotificationTargetProvider } from './pbs-notification-target.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007', mount: 'pbs-test', scheme: 'pbs' };
const MATCHER = { name: 'pager', target: PBS, targets: ['mail-to-root'] };
const TARGET = { name: 'mail-to-root', target: PBS, type: 'sendmail' as const };

for (const status of [401, 403, 500, 503]) {
  test(`PBS ${String(status)} fails cold adoption and cannot POST either notification family`, async () => {
    const fake = fakePve(() => Response.json({ message: 'read refused' }, { status }));
    const providers = Layer.mergeAll(
      PbsNotificationMatcherProvider(),
      PbsNotificationTargetProvider(),
    );
    const stack = Effect.gen(function* () {
      yield* PbsNotificationMatcher('pager', MATCHER);
      yield* PbsNotificationTarget('mail', TARGET);
    });
    await withoutBao(async () => {
      const engine = engineOver(providers.pipe(Layer.provideMerge(fake.layer)));
      await expect(engine.deploy(stack)).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });
}

test('only the typed NotFound is absence, and deleting it is idempotent for both families', async () => {
  // PBS 4.2 read-only missing-name probe, 2026-09-24: notification absence is plain-text 404.
  const fake = fakePve(() => new Response("matcher 'pager' not found", { status: 404 }));
  await withoutBao(async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const matcher = yield* readMatcher(MATCHER);
        const target = yield* readTarget(TARGET);
        yield* deleteMatcher(MATCHER);
        yield* deleteTarget(TARGET);
        return { matcher, target };
      }).pipe(Effect.provide(fake.layer)),
    );
    expect(outcome).toEqual({ matcher: undefined, target: undefined });
  });
});

test('a malformed successful resource response is a failure, never absence', async () => {
  const fake = fakePve(() => undefined);
  await withoutBao(async () => {
    for (const read of [
      readMatcher(MATCHER).pipe(Effect.asVoid),
      readTarget(TARGET).pipe(Effect.asVoid),
    ]) {
      await expect(Effect.runPromise(read.pipe(Effect.provide(fake.layer)))).rejects.toBeDefined();
    }
  });
  expect(fake.writes()).toEqual([]);
});

test('typed write errors also propagate instead of being treated as completed deletes', async () => {
  const fake = fakePve(() => Response.json({ message: 'permission denied' }, { status: 403 }));
  await withoutBao(async () => {
    for (const remove of [deleteMatcher(MATCHER), deleteTarget(TARGET)]) {
      const error = await Effect.runPromise(remove.pipe(Effect.flip, Effect.provide(fake.layer)));
      expect(error).toMatchObject({ _tag: 'Forbidden' });
    }
  });
  expect(fake.writes()).toHaveLength(2);
});

test('invalid SDK input never echoes a write-only value or sends a vendor request', async () => {
  const fake = fakePve(() => undefined);
  await withoutBao(async () => {
    const error = await Effect.runPromise(
      createTarget(
        { ...TARGET, type: 'smtp' },
        { name: TARGET.name, password: 'invalid-input-secret-must-stay-private' },
      ).pipe(Effect.flip, Effect.provide(fake.layer)),
    );
    expect(error).toMatchObject({ _tag: 'PbsNotificationInputRefusal' });
    expect(JSON.stringify(error)).not.toContain('invalid-input-secret-must-stay-private');
  });
  expect(fake.calls).toEqual([]);
});
