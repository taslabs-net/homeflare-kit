/**
 * `Paperless.CustomField.dataType` is create-only: a change is refused at plan time, never
 * silently PATCHed and never routed to a replace. See custom-field.ts's header for why — a
 * replace would delete the field's value on every document.
 *
 * ⛔ THESE TESTS FAIL WITHOUT THE UNIT. `custom-field.ts` did not exist before this change.
 */
import { describe, expect, test } from 'bun:test';
import { customFieldHandlers, dataTypeImmutable } from './custom-field.ts';
import { run, withFake } from './fake-paperless.ts';

describe('dataTypeImmutable, the pure rule', () => {
  test('no refusal when the live value is unchanged', () => {
    expect(
      dataTypeImmutable({ data_type: 'string', id: 1 }, { dataType: 'string', name: 'x' }),
    ).toBeUndefined();
  });

  test('a refusal when the live value differs, naming both values', () => {
    const message = dataTypeImmutable(
      { data_type: 'select', id: 1 },
      { dataType: 'string', name: 'Status' },
    );
    expect(message).toMatch(/data_type is create-only/);
    expect(message).toContain('live: select');
    expect(message).toContain('declared: string');
  });
});

describe('the live lifecycle refuses a data_type change', () => {
  test('reconcile dies rather than PATCHing a changed data_type', async () => {
    await withFake(async (fake) => {
      await run(customFieldHandlers.reconcile({ news: { dataType: 'select', name: 'Status' } }));
      const before = fake.seen.filter((s) => s.method !== 'GET').length;

      await expect(
        run(customFieldHandlers.reconcile({ news: { dataType: 'string', name: 'Status' } })),
      ).rejects.toThrow(/data_type is create-only/);

      // ⛔ NOTHING WAS WRITTEN — the refusal fires before the PATCH, not after a failed one.
      expect(fake.seen.filter((s) => s.method !== 'GET').length).toBe(before);
    });
  });

  test('a create followed by a declaration of the SAME data_type is a normal no-drift reconcile', async () => {
    await withFake(async () => {
      await run(customFieldHandlers.reconcile({ news: { dataType: 'select', name: 'Status' } }));
      const after = await run(
        customFieldHandlers.reconcile({ news: { dataType: 'select', name: 'Status' } }),
      );
      expect(after).toMatchObject({ dataType: 'select', name: 'Status' });
    });
  });

  test('extraData still updates through a normal PATCH', async () => {
    await withFake(async (fake) => {
      await run(
        customFieldHandlers.reconcile({
          news: { dataType: 'select', extraData: { select_options: ['a'] }, name: 'Status' },
        }),
      );
      await run(
        customFieldHandlers.reconcile({
          news: { dataType: 'select', extraData: { select_options: ['a', 'b'] }, name: 'Status' },
        }),
      );
      const patch = fake.seen.find((s) => s.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({
        extra_data: { select_options: ['a', 'b'] },
      });
    });
  });
});
