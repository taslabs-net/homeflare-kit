/** A readable PBS section does not make a refused DELETE successful. No live calls. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { withFakeBao } from './fake-bao-env.ts';
import { PBS_JOBS_TARGET, fakePbsJobs } from './fake-pbs-jobs.ts';
import { deleteOne as deleteDatastore } from './pbs-datastore-wire.ts';
import { deleteOne as deletePrune } from './pbs-prune-job-wire.ts';
import { deleteOne as deleteSync } from './pbs-sync-job-wire.ts';
import { deleteOne as deleteVerify } from './pbs-verify-job-wire.ts';

test('all four PBS DELETE paths propagate a typed refusal after a successful pre-read', async () => {
  const fake = fakePbsJobs();
  const target = PBS_JOBS_TARGET;
  fake.rows.set('config/datastore/store', { name: 'store', path: '/mnt/store' });
  fake.rows.set('config/prune/prune', { id: 'prune', store: 'store', schedule: 'daily' });
  fake.rows.set('config/sync/sync', { id: 'sync', store: 'store', 'remote-store': 'other' });
  fake.rows.set('config/verify/verify', { id: 'verify', store: 'store' });
  // ★ A permission refusal exercises propagation without inventing an absent-DELETE shape.
  fake.failDelete(403, { message: 'permission denied' });
  const deletions = [
    deleteDatastore({ name: 'store', path: '/mnt/store', target }).pipe(Effect.asVoid),
    deletePrune({ id: 'prune', store: 'store', schedule: 'daily', target }).pipe(Effect.asVoid),
    deleteSync({ id: 'sync', store: 'store', 'remote-store': 'other', target }).pipe(Effect.asVoid),
    deleteVerify({ id: 'verify', store: 'store', schedule: null, target }).pipe(Effect.asVoid),
  ];
  await withFakeBao('http://bao.invalid', async () => {
    for (const deletion of deletions) {
      const error = await Effect.runPromise(deletion.pipe(Effect.flip, Effect.provide(fake.layer)));
      expect(error).toMatchObject({ _tag: 'Forbidden' });
    }
  });
  expect(fake.calls.filter((call) => call.method === 'GET')).toHaveLength(4);
  expect(fake.writes.map((write) => write.method)).toEqual([
    'DELETE',
    'DELETE',
    'DELETE',
    'DELETE',
  ]);
  expect(fake.rows.size).toBe(4);
});
