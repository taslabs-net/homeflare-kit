/**
 * `Tag`'s exported production `spec`, driven through `matchingOperations` against a fake
 * Paperless-ngx that speaks the real distilled wire protocol — the successor to the pre-migration
 * `matching.test.ts`, now proving `@distilled.cloud/paperless-ngx`'s real path assembly, JSON
 * encode/decode and status→typed-error matching (`404` → `NotFound`, `403` → `Forbidden`, …)
 * instead of a hand-rolled minimal spec against a status-carrying `PaperlessError`.
 * `matching-locate.test.ts` covers the pure identity rule; `tag-identity.test.ts` covers the
 * PR 163 rename/re-own/delete-out-of-band regression suite this file does not repeat.
 *
 * ⚠️ `handlers` (tag.ts's own export, built by `matchingHandlers`) IS NOT USED HERE — it bakes in
 *   `CredentialsFromEnv`, which resolves through Effect `Config` and cannot be redirected to a
 *   fake once built (fake-paperless.ts's own header). Every test calls `matchingOperations(spec)`
 *   instead, with an explicit fake `Credentials` layer — the same seam
 *   `../netbox/prefix.test.ts`/`../forgejo/repository.test.ts` use.
 */
import { describe, expect, test } from 'bun:test';
import { fakePaperless, run, runFailure } from './fake-paperless.ts';
import { matchingOperations } from './matching.ts';
import { spec } from './tag.ts';

const ops = matchingOperations(spec);

describe('create always carries owner, null when undeclared', () => {
  test('a create with no owner prop sends owner: null', async () => {
    const fake = fakePaperless();
    await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    const post = fake.seen.find((s) => s.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ name: 'Invoices', owner: null });
  });

  test('a create with an owner prop sends that owner', async () => {
    const fake = fakePaperless();
    await run(ops.reconcile({ name: 'Receipts', owner: 7 }, undefined), fake.fetch);
    const post = fake.seen.find((s) => s.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ owner: 7 });
  });
});

test('a no-drift reconcile makes zero writes', async () => {
  const fake = fakePaperless();
  await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
  const before = fake.seen.filter((s) => s.method !== 'GET').length;
  await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
  expect(fake.seen.filter((s) => s.method !== 'GET').length).toBe(before);
});

test('a 403 fails as Forbidden rather than reading as absent', async () => {
  const fake = fakePaperless();
  fake.forceStatus = 403;
  const error = await runFailure(ops.read({ name: 'Invoices' }), fake.fetch);
  expect((error as { _tag?: string })._tag).toBe('Forbidden');
});

test('a 404 on read folds to absent (create is the right plan)', async () => {
  const fake = fakePaperless();
  expect(await run(ops.read({ name: 'Nothing here' }), fake.fetch)).toBeUndefined();
});

describe('case-insensitive locate, case-sensitive identity', () => {
  test('two differently-cased names never collapse into one object', async () => {
    const fake = fakePaperless();
    await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    await run(ops.reconcile({ name: 'invoices' }, undefined), fake.fetch);
    expect(fake.rows('tags').length).toBe(2);

    const exact = await run(ops.read({ name: 'Invoices' }), fake.fetch);
    expect(exact?.name).toBe('Invoices');
    const other = await run(ops.read({ name: 'invoices' }), fake.fetch);
    expect(other?.name).toBe('invoices');
  });
});

test('a PATCH sends only the fields that differ from the live row', async () => {
  const fake = fakePaperless();
  await run(ops.reconcile({ color: '#a6cee3', name: 'Invoices' }, undefined), fake.fetch);
  const created = await run(ops.read({ name: 'Invoices' }), fake.fetch);

  const after = await run(
    ops.reconcile({ color: '#a6cee3', match: 'invoice', name: 'Invoices' }, created),
    fake.fetch,
  );

  const patch = fake.seen.find((s) => s.method === 'PATCH');
  expect(patch).toBeDefined();
  expect(JSON.parse(patch?.body ?? '{}')).toEqual({ match: 'invoice' });
  expect(after?.match).toBe('invoice');
});

test('destroy DELETEs the live row and is idempotent when already gone', async () => {
  const fake = fakePaperless();
  await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
  const created = await run(ops.read({ name: 'Invoices' }), fake.fetch);

  await run(ops.destroy({ name: 'Invoices' }, created), fake.fetch);
  expect(fake.rows('tags').length).toBe(0);

  // ⚠️ A second destroy of the same (now-absent) row must not throw.
  await run(ops.destroy({ name: 'Invoices' }, created), fake.fetch);
});
