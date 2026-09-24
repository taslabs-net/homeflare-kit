/** Vendor-specific failures and normalization at the actual distilled HTTP boundary. */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { readBackupJob } from './backup-job-distilled.ts';
import { ProxmoxBackupJob, ProxmoxBackupJobProvider } from './backup-job.ts';
import { fakePve, withoutBao } from './fake-pve.ts';
import { backupProps, coreCases, metricProps } from './live-core-fixtures.ts';
import { deleteMetricServer, readMetricServer } from './metric-server-distilled.ts';
import { ProxmoxMetricServer, ProxmoxMetricServerProvider } from './metric-server.ts';

for (const entry of coreCases) {
  describe(`${entry.name} wire`, () => {
    test('only the typed missing signal returns undefined', async () => {
      const fake = fakePve(entry.missing);
      await withoutBao(async () => {
        expect(
          await Effect.runPromise(entry.read().pipe(Effect.provide(fake.layer))),
        ).toBeUndefined();
      });
      expect(fake.writes()).toEqual([]);
    });
    test('deleting an already missing object succeeds', async () => {
      const fake = fakePve(entry.missing);
      await withoutBao(async () => {
        await Effect.runPromise(entry.remove().pipe(Effect.provide(fake.layer)));
      });
      expect(fake.writes()).toEqual(entry.name === 'MetricServer' ? [] : [`DELETE ${entry.path}`]);
    });
    for (const [status, tag] of [
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [500, 'InternalServerError'],
    ] as const) {
      test(`${status} remains typed ${tag}`, async () => {
        const fake = fakePve(() =>
          Response.json({ message: 'unrelated failure', data: null }, { status }),
        );
        await withoutBao(async () => {
          expect(
            await Effect.runPromise(entry.read().pipe(Effect.flip, Effect.provide(fake.layer))),
          ).toMatchObject({ _tag: tag });
        });
        expect(fake.writes()).toEqual([]);
      });
    }
    if (entry.name !== 'MetricServer') {
      test('a successful null payload fails the generated response schema', async () => {
        const fake = fakePve(() => null);
        await withoutBao(async () => {
          expect(
            await Effect.runPromise(entry.read().pipe(Effect.flip, Effect.provide(fake.layer))),
          ).toMatchObject({ _tag: 'ProxmoxParseError', body: undefined });
          await expect(entry.engine(fake).deploy(entry.declare())).rejects.toBeDefined();
        });
        expect(fake.writes()).toEqual([]);
      });
    }
  });
}

test('BackupJob keeps genuine validation failure distinct from a missing id', async () => {
  const fake = fakePve(() =>
    Response.json(
      {
        data: null,
        message: 'Parameter verification failed.\n',
        errors: { id: "No such job 'nightly'", schedule: 'invalid calendar expression' },
      },
      { status: 400 },
    ),
  );
  await withoutBao(async () => {
    expect(
      await Effect.runPromise(
        readBackupJob(backupProps).pipe(Effect.flip, Effect.provide(fake.layer)),
      ),
    ).toMatchObject({ _tag: 'ParameterVerificationFailed' });
  });
  expect(fake.writes()).toEqual([]);
});

for (const expanded of [false, true]) {
  test(`BackupJob canonicalizes retention and fleecing (${expanded ? 'expanded objects' : 'legacy strings'})`, async () => {
    const fake = fakePve(() => ({
      id: backupProps.id,
      schedule: backupProps.schedule,
      'prune-backups': expanded
        ? { 'keep-weekly': 4, 'keep-daily': 7 }
        : 'keep-weekly=4,keep-daily=7',
      fleecing: expanded ? { enabled: 1, storage: 'fast' } : 'enabled=1,storage=fast',
      'next-run': 123456,
      'notes-template': '{{guestname}}',
      'repeat-missed': 1,
      'notification-mode': 'notification-system',
    }));
    await withoutBao(async () => {
      expect(
        await Effect.runPromise(readBackupJob(backupProps).pipe(Effect.provide(fake.layer))),
      ).toMatchObject({
        'prune-backups': 'keep-daily=7,keep-weekly=4',
        fleecing: 'enabled=1,storage=fast',
        'next-run': 123456,
        'notes-template': '{{guestname}}',
        'repeat-missed': true,
        'notification-mode': 'notification-system',
      });
      const props = {
        ...backupProps,
        vmid: undefined,
        fleecing: 'enabled=1,storage=fast',
        'notes-template': '{{guestname}}',
        'repeat-missed': true,
        'notification-mode': 'notification-system' as const,
      };
      const { vmid: _omitted, ...declared } = props;
      const engine = engineOver(ProxmoxBackupJobProvider().pipe(Layer.provideMerge(fake.layer)));
      expect((await engine.verify(ProxmoxBackupJob('row', declared))).rows[0]).toMatchObject({
        diff: 'noop',
      });
      await engine.deploy(ProxmoxBackupJob('row', declared));
    });
    expect(fake.writes()).toEqual([]);
  });
}

test('MetricServer rejects a malformed non-object without leaking its payload', async () => {
  const fake = fakePve(() => 'fixture-secret-value');
  await withoutBao(async () => {
    const error = await Effect.runPromise(
      readMetricServer(metricProps).pipe(Effect.flip, Effect.provide(fake.layer)),
    );
    expect(error).toMatchObject({ _tag: 'ProxmoxParseError', body: undefined });
    expect(JSON.stringify(error)).not.toContain('fixture-secret-value');
  });
  expect(fake.writes()).toEqual([]);
});

test('MetricServer delete race propagates an unclassified vendor refusal', async () => {
  const fake = fakePve((call) =>
    call.method === 'GET'
      ? { type: 'influxdb', server: 'metrics.test', port: 8086 }
      : Response.json({ data: null, message: 'unable to read plugin type' }, { status: 500 }),
  );
  await withoutBao(async () => {
    expect(
      await Effect.runPromise(
        deleteMetricServer(metricProps).pipe(Effect.flip, Effect.provide(fake.layer)),
      ),
    ).toMatchObject({ _tag: 'InternalServerError' });
  });
  expect(fake.writes()).toEqual(['DELETE cluster/metrics/server/metrics']);
});

test('MetricServer OTEL updates preserve plugin-specific wire names and secrets', async () => {
  const props = {
    ...metricProps,
    type: 'opentelemetry' as const,
    'otel-protocol': 'http' as const,
    'otel-path': '/ingest',
    'otel-compression': 'none' as const,
    'otel-timeout': 7,
    'otel-max-body-size': 2048,
    'otel-verify-ssl': false,
  };
  const fake = fakePve(() => ({
    type: 'opentelemetry',
    server: 'old.test',
    port: 8086,
    'otel-headers': 'fixture-secret-value',
  }));
  await withoutBao(async () => {
    const engine = engineOver(ProxmoxMetricServerProvider().pipe(Layer.provideMerge(fake.layer)));
    await engine.deploy(ProxmoxMetricServer('row', props));
    expect(engine.stored()).not.toContain('fixture-secret-value');
  });
  expect(fake.writes()).toEqual(['PUT cluster/metrics/server/metrics']);
  expect(fake.calls.find((call) => call.method === 'PUT')?.form).toEqual({
    server: 'metrics.test',
    port: '8086',
    disable: '0',
    'otel-protocol': 'http',
    'otel-path': '/ingest',
    'otel-compression': 'none',
    'otel-timeout': '7',
    'otel-max-body-size': '2048',
    'otel-verify-ssl': '0',
  });
});
