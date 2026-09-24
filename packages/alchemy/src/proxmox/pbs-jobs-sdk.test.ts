/** Four PBS families through the real SDK and Alchemy's upstream test harness. */
import { afterEach, beforeEach, expect } from 'bun:test';
import * as Test from 'alchemy/Test/Bun';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { PBS_JOBS_TARGET, fakePbsJobs } from './fake-pbs-jobs.ts';
import { PbsDatastore, PbsDatastoreProvider } from './pbs-datastore.ts';
import { deleteOne as deleteDatastore } from './pbs-datastore-wire.ts';
import { PbsPruneJob, PbsPruneJobProvider } from './pbs-prune-job.ts';
import { PbsSyncJob, PbsSyncJobProvider } from './pbs-sync-job.ts';
import { PbsVerifyJob, PbsVerifyJobProvider } from './pbs-verify-job.ts';

const fake = fakePbsJobs();
// ⛔ Test harness hooks take Effects, so isolate the shell before its per-test runtime starts.
let saved: [string, string | undefined][] = [];
beforeEach(() => {
  saved = Object.entries(process.env).filter(([key]) => /^(BAO|VAULT)_/.test(key));
  for (const [key] of saved) delete process.env[key];
  process.env['BAO_ADDR'] = 'http://bao.invalid';
  fake.reset();
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
    PbsDatastoreProvider(),
    PbsPruneJobProvider(),
    PbsSyncJobProvider(),
    PbsVerifyJobProvider(),
  ).pipe(Layer.provideMerge(fake.layer)),
});

const stack = (comment = 'current') =>
  Effect.gen(function* () {
    yield* PbsDatastore('store', {
      name: 'store',
      path: '/mnt/store',
      'gc-schedule': 'daily',
      'verify-new': false,
      comment,
      target: PBS_JOBS_TARGET,
    });
    yield* PbsPruneJob('prune', {
      id: 'prune',
      store: 'store',
      schedule: 'daily',
      'keep-daily': 30,
      'max-depth': 0,
      comment,
      target: PBS_JOBS_TARGET,
    });
    yield* PbsSyncJob('sync', {
      id: 'sync',
      store: 'store',
      'remote-store': 'other',
      'remote-ns': 'archive',
      'remove-vanished': false,
      'max-depth': 0,
      'verified-only': true,
      comment,
      target: PBS_JOBS_TARGET,
    });
    yield* PbsVerifyJob('verify', {
      id: 'verify',
      store: 'store',
      schedule: null,
      'outdated-after': 30,
      comment,
      target: PBS_JOBS_TARGET,
    });
  });

const existing = () => {
  fake.rows.set('config/datastore/store', {
    name: 'store',
    path: '/mnt/store',
    'gc-schedule': 'daily',
    'verify-new': false,
    comment: 'current',
  });
  fake.rows.set('config/prune/prune', {
    id: 'prune',
    store: 'store',
    schedule: 'daily',
    'keep-daily': 30,
    'max-depth': 0,
    comment: 'current',
  });
  fake.rows.set('config/sync/sync', {
    id: 'sync',
    store: 'store',
    'remote-store': 'other',
    'remote-ns': 'archive',
    'remove-vanished': false,
    'max-depth': 0,
    'verified-only': true,
    comment: 'current',
  });
  fake.rows.set('config/verify/verify', {
    id: 'verify',
    store: 'store',
    'ignore-verified': true,
    'outdated-after': 30,
    comment: 'current',
  });
};

const actions = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources)
    .map((row) => row.action)
    .sort();

test.provider(
  'matching datastore and three job families adopt without writes, then plan noop',
  (scratch) =>
    Effect.gen(function* () {
      existing();
      yield* scratch.deploy(stack());
      expect(fake.writes).toEqual([]);
      expect(actions(yield* scratch.plan(stack()))).toEqual(['noop', 'noop', 'noop', 'noop']);
    }),
);

test.provider(
  'measured missing sections create through typed SDK forms and settle to noop',
  (scratch) =>
    Effect.gen(function* () {
      yield* scratch.deploy(stack());
      expect(fake.writes.map((row) => `${row.method} ${row.path}`).sort()).toEqual([
        'POST config/datastore',
        'POST config/prune',
        'POST config/sync',
        'POST config/verify',
      ]);
      expect(fake.writes.find((row) => row.path === 'config/prune')?.form).toMatchObject({
        'keep-daily': '30',
        'max-depth': '0',
      });
      expect(fake.writes.find((row) => row.path === 'config/sync')?.form).toMatchObject({
        'remote-store': 'other',
        'remote-ns': 'archive',
        'remove-vanished': '0',
        'verified-only': '1',
      });
      expect(fake.writes.find((row) => row.path === 'config/verify')?.form).not.toHaveProperty(
        'schedule',
      );
      expect(actions(yield* scratch.plan(stack()))).toEqual(['noop', 'noop', 'noop', 'noop']);
    }),
);

test.provider(
  'drift updates only declared fields through SDK forms and the next plan is noop',
  (scratch) =>
    Effect.gen(function* () {
      existing();
      yield* scratch.deploy(stack());
      yield* scratch.deploy(stack('changed'));
      expect(fake.writes.map((row) => `${row.method} ${row.path}`).sort()).toEqual([
        'PUT config/datastore/store',
        'PUT config/prune/prune',
        'PUT config/sync/sync',
        'PUT config/verify/verify',
      ]);
      for (const write of fake.writes) expect(write.form).not.toHaveProperty('delete');
      expect(actions(yield* scratch.plan(stack('changed')))).toEqual([
        'noop',
        'noop',
        'noop',
        'noop',
      ]);
    }),
);

for (const status of [200, 400, 401, 403, 500]) {
  test.provider(
    `HTTP ${status} malformed or refused read never becomes create or noop`,
    (scratch) =>
      Effect.gen(function* () {
        existing();
        yield* scratch.deploy(stack());
        fake.failRead(status, { message: 'unrelated server refusal', data: null });
        const result = yield* Effect.exit(scratch.plan(stack()));
        expect(result._tag).toBe('Failure');
        expect(fake.writes).toEqual([]);
        // Clear the injected failure before Test.Bun's automatic fixture teardown.
        fake.reset();
      }),
  );
}

test.provider(
  'a refused datastore delete read cannot confirm deletion; already absent needs no write',
  (scratch) =>
    Effect.gen(function* () {
      existing();
      yield* scratch.deploy(stack());
      const props = { name: 'store', path: '/mnt/store', target: PBS_JOBS_TARGET };
      fake.failRead(403, { message: 'permission denied', data: null });
      expect((yield* Effect.exit(deleteDatastore(props)))._tag).toBe('Failure');
      expect(fake.writes).toEqual([]);
      fake.reset();
      yield* deleteDatastore(props);
      yield* scratch.destroy();
      expect(fake.writes).toEqual([]);
    }),
);
