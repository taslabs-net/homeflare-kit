/**
 * `StoragePath`'s exported production `spec` against a fake Paperless-ngx — proves this file's
 * own `@distilled.cloud/paperless-ngx/storage_paths` wiring (right operations, right field names,
 * including the vendor-required `path` template) round-trips for real. See document-type.test.ts
 * and tag.ts's own header for why the shared engine and PR 163 are not re-proven here.
 */
import { describe, expect, test } from 'bun:test';
import { fakePaperless, run } from './fake-paperless.ts';
import { matchingOperations } from './matching.ts';
import { spec } from './storage-path.ts';

const ops = matchingOperations(spec);

test('create sends the required path field alongside owner: null', async () => {
  const fake = fakePaperless();
  await run(
    ops.reconcile({ name: 'By correspondent', path: '{correspondent}/{title}' }, undefined),
    fake.fetch,
  );
  const post = fake.seen.find((s) => s.method === 'POST');
  expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
    name: 'By correspondent',
    owner: null,
    path: '{correspondent}/{title}',
  });
});

describe('a full create → read → patch → delete round trip', () => {
  test('the real distilled wire path carries the path template through a rename', async () => {
    const fake = fakePaperless();
    const created = await run(
      ops.reconcile({ name: 'By correspondent', path: '{correspondent}/{title}' }, undefined),
      fake.fetch,
    );
    expect(created).toMatchObject({ name: 'By correspondent', path: '{correspondent}/{title}' });

    const after = await run(
      ops.reconcile({ name: 'By correspondent', path: '{correspondent}/{created}' }, created),
      fake.fetch,
    );
    const patch = fake.seen.find((s) => s.method === 'PATCH');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ path: '{correspondent}/{created}' });
    expect(after?.path).toBe('{correspondent}/{created}');

    await run(
      ops.destroy({ name: 'By correspondent', path: '{correspondent}/{created}' }, after),
      fake.fetch,
    );
    expect(fake.rows('storage_paths').length).toBe(0);
  });
});

test('a 404 on read folds to absent', async () => {
  const fake = fakePaperless();
  expect(await run(ops.read({ name: 'Nothing here', path: 'x' }), fake.fetch)).toBeUndefined();
});
