/**
 * `DocumentType`'s exported production `spec` against a fake Paperless-ngx — proves this file's
 * own `@distilled.cloud/paperless-ngx/document_types` wiring (right operations, right field
 * names) round-trips for real. The shared `matching.ts` engine and the PR 163 identity switch are
 * proven generically by `tag.test.ts`/`tag-identity.test.ts`/`matching-locate.test.ts`; this file
 * does not repeat that coverage.
 */
import { describe, expect, test } from 'bun:test';
import { spec } from './document-type.ts';
import { fakePaperless, run } from './fake-paperless.ts';
import { matchingOperations } from './matching.ts';

const ops = matchingOperations(spec);

test('create sends owner: null when undeclared, and the constraint-checked body', async () => {
  const fake = fakePaperless();
  await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
  const post = fake.seen.find((s) => s.method === 'POST');
  expect(post).toBeDefined();
  expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ name: 'Invoices', owner: null });
});

describe('a full create → read → patch → delete round trip', () => {
  test('the real distilled wire path carries every field through', async () => {
    const fake = fakePaperless();
    const created = await run(
      ops.reconcile({ isInsensitive: true, match: 'invoice', name: 'Invoices' }, undefined),
      fake.fetch,
    );
    expect(created).toMatchObject({ isInsensitive: true, match: 'invoice', name: 'Invoices' });

    const after = await run(
      ops.reconcile({ isInsensitive: true, match: 'receipt', name: 'Invoices' }, created),
      fake.fetch,
    );
    const patch = fake.seen.find((s) => s.method === 'PATCH');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ match: 'receipt' });
    expect(after?.match).toBe('receipt');

    await run(ops.destroy({ name: 'Invoices' }, after), fake.fetch);
    expect(fake.rows('document_types').length).toBe(0);
  });
});

test('a 404 on read folds to absent', async () => {
  const fake = fakePaperless();
  expect(await run(ops.read({ name: 'Nothing here' }), fake.fetch)).toBeUndefined();
});
