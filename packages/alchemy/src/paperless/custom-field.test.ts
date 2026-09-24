/**
 * `Paperless.CustomField.dataType` is create-only: a change is refused at plan time, never
 * silently PATCHed and never routed to a replace. See custom-field.ts's header for why — a
 * replace would delete the field's value on every document. The live-lifecycle tests below drive
 * the real `@distilled.cloud/paperless-ngx` wire path (tag.test.ts's own note on why
 * `matchingOperations(spec)`, not `customFieldHandlers`, is what a test can point at a fake).
 */
import { describe, expect, test } from 'bun:test';
import { dataTypeImmutable, spec } from './custom-field.ts';
import { fakePaperless, run } from './fake-paperless.ts';
import { matchingOperations } from './matching.ts';

const ops = matchingOperations(spec);

describe('dataTypeImmutable, the pure rule', () => {
  test('no refusal when the live value is unchanged', () => {
    expect(
      dataTypeImmutable({ data_type: 'string' }, { dataType: 'string', name: 'x' }),
    ).toBeUndefined();
  });

  test('a refusal when the live value differs, naming both values', () => {
    const message = dataTypeImmutable(
      { data_type: 'select' },
      { dataType: 'string', name: 'Status' },
    );
    expect(message).toMatch(/data_type is create-only/);
    expect(message).toContain('live: select');
    expect(message).toContain('declared: string');
  });
});

describe('the live lifecycle refuses a data_type change', () => {
  test('reconcile dies rather than PATCHing a changed data_type', async () => {
    const fake = fakePaperless();
    const created = await run(
      ops.reconcile({ dataType: 'select', name: 'Status' }, undefined),
      fake.fetch,
    );
    const before = fake.seen.filter((s) => s.method !== 'GET').length;

    await expect(
      run(ops.reconcile({ dataType: 'string', name: 'Status' }, created), fake.fetch),
    ).rejects.toThrow(/data_type is create-only/);

    // ⛔ NOTHING WAS WRITTEN — the refusal fires before the PATCH, not after a failed one.
    expect(fake.seen.filter((s) => s.method !== 'GET').length).toBe(before);
  });

  test('a create followed by a declaration of the SAME data_type is a normal no-drift reconcile', async () => {
    const fake = fakePaperless();
    const created = await run(
      ops.reconcile({ dataType: 'select', name: 'Status' }, undefined),
      fake.fetch,
    );
    const after = await run(
      ops.reconcile({ dataType: 'select', name: 'Status' }, created),
      fake.fetch,
    );
    expect(after).toMatchObject({ dataType: 'select', name: 'Status' });
  });

  test('extraData still updates through a normal PATCH', async () => {
    const fake = fakePaperless();
    const created = await run(
      ops.reconcile(
        { dataType: 'select', extraData: { select_options: ['a'] }, name: 'Status' },
        undefined,
      ),
      fake.fetch,
    );
    await run(
      ops.reconcile(
        { dataType: 'select', extraData: { select_options: ['a', 'b'] }, name: 'Status' },
        created,
      ),
      fake.fetch,
    );
    const patch = fake.seen.find((s) => s.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ extra_data: { select_options: ['a', 'b'] } });
  });
});
