/**
 * Regression suite for the PR 163 red-team HIGH finding: `diff`/`reconcile` re-derived identity
 * from `news` alone on every call, so renaming (or re-owning) an already-deployed Tag/
 * DocumentType/StoragePath/CustomField missed the row it previously wrote, POSTed a second
 * object under the new name/owner, and left the original permanently orphaned — while `diff`
 * reported a plain `{action:'update'}`. See `matching.ts`'s header for the fix: once `output` is
 * defined, identity is `output.id`, not `(name, owner)`.
 *
 * ⛔ EVERY TEST HERE FAILS ON THE PRE-FIX `matching.ts` (measured before the fix landed — see the
 *   PR comment this file was introduced with):
 *   - the two rename/re-own tests fail because a second POST fires and `fake.rows('tags').length`
 *     is 2, not 1 (the exact duplicate-and-orphan bug);
 *   - the deleted-out-of-band test fails because `diff` never called `fetchLive` at all when
 *     `output` was ignored the pre-fix way — it silently returns `{action:'update'}`  instead of
 *     refusing;
 *   - the first-create and adopt tests already passed pre-fix (the no-state path was never
 *     broken) and are here to prove the fix does not disturb them.
 */
import { describe, expect, test } from 'bun:test';
import { paperless } from './client.ts';
import { type MatchingProps, matchingHandlers, matchingOperations } from './matching.ts';
import { run, withFake } from './fake-paperless.ts';

interface Props extends MatchingProps {
  note?: string;
}
/** ★ The same minimal spec `matching.test.ts` uses — this suite tests `matching.ts`'s own identity contract, not any one family's wiring. */
const spec = {
  attributes: (live: Record<string, unknown>, props: Props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      id,
      name: typeof live['name'] === 'string' ? live['name'] : props.name,
      note: typeof live['note'] === 'string' ? live['note'] : '',
      owner: typeof live['owner'] === 'number' ? live['owner'] : undefined,
    };
  },
  collection: 'tags' as const,
  describe: (props: Props) => `tags ${props.name}`,
  endpoint: { create: 'paperless:POST /api/tags/', update: 'paperless:PATCH /api/tags/{id}/' },
  fields: [
    { key: 'note', live: (r: Record<string, unknown>) => r['note'], prop: (p: Props) => p.note },
  ],
};

const writesOf = (fake: { seen: readonly { method: string }[] }) =>
  fake.seen.filter((s) => s.method !== 'GET');

describe('renaming or re-owning an already-deployed object (PR 163)', () => {
  test('a rename PATCHes the same id — no POST, no orphan', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      const created = await run(handlers.reconcile({ news: { name: 'Invoices' } }));
      const before = writesOf(fake).length;

      const renamed = await run(
        handlers.reconcile({ news: { name: 'Invoices - Renamed' }, output: created }),
      );

      const writes = writesOf(fake);
      const newWrites = writes.slice(before);
      expect(writes.length).toBe(before + 1);
      expect(newWrites.every((w) => w.method === 'PATCH')).toBe(true);
      expect(fake.rows('tags').length).toBe(1);
      expect(renamed?.id).toBe(created?.id);
      expect(renamed?.name).toBe('Invoices - Renamed');
    });
  });

  test('an owner change PATCHes the same id — no POST, no orphan', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      const created = await run(handlers.reconcile({ news: { name: 'Invoices', owner: 7 } }));
      const before = writesOf(fake).length;

      const reowned = await run(
        handlers.reconcile({ news: { name: 'Invoices', owner: 9 }, output: created }),
      );

      const writes = writesOf(fake);
      expect(writes.length).toBe(before + 1);
      expect(writes[writes.length - 1]?.method).toBe('PATCH');
      expect(fake.rows('tags').length).toBe(1);
      expect(reowned?.id).toBe(created?.id);
      expect(reowned?.owner).toBe(9);
    });
  });
});

describe('a deleted-out-of-band object (PR 163)', () => {
  test('diff refuses at plan rather than creating a replacement', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      const created = await run(handlers.reconcile({ news: { name: 'Invoices' } }));
      await run(paperless('DELETE', `tags/${String(created?.id)}/`));

      await expect(
        run(handlers.diff({ news: { name: 'Invoices' }, output: created })),
      ).rejects.toThrow(/no longer exists live|deleted out of band/);

      expect(fake.rows('tags').length).toBe(0);
    });
  });

  test('reconcile also refuses, not only diff, if called with no prior diff', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      const created = await run(handlers.reconcile({ news: { name: 'Invoices' } }));
      await run(paperless('DELETE', `tags/${String(created?.id)}/`));

      await expect(
        run(handlers.reconcile({ news: { name: 'Invoices' }, output: created })),
      ).rejects.toThrow(/no longer exists live|deleted out of band/);

      expect(fake.rows('tags').length).toBe(0);
    });
  });
});

describe('the no-state path is unaffected (PR 163)', () => {
  test('a first create still locates by name', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      await run(handlers.reconcile({ news: { name: 'Invoices' } }));

      const get = fake.seen.find((s) => s.method === 'GET');
      expect(get?.path).toContain('name__iexact=Invoices');
      const post = fake.seen.find((s) => s.method === 'POST');
      expect(post).toBeDefined();
    });
  });

  test("adopt (output populated from the engine's own read) locates the id it read, no duplicate", async () => {
    await withFake(async (fake) => {
      const ops = matchingOperations(spec);
      const handlers = matchingHandlers(spec);
      // A pre-existing object, created out of band — what the engine's `provider.read` (always
      // called with `output: undefined`) discovers during its adoption probe (`Plan.ts`).
      await run(paperless('POST', 'tags/', { name: 'Invoices', owner: null }));
      const readAttrs = await run(ops.read({ name: 'Invoices' }));
      expect(readAttrs).toBeDefined();
      if (readAttrs === undefined) throw new Error('unreachable: asserted defined above');

      // The engine forces `action: 'adopted'` through the normal update/reconcile path with
      // `output: node.state.attr` already the just-read attributes (Apply.ts).
      const after = await run(
        handlers.reconcile({ news: { name: 'Invoices' }, output: readAttrs }),
      );

      expect(fake.rows('tags').length).toBe(1);
      expect(after?.id).toBe(readAttrs?.id);
      expect(fake.seen.filter((s) => s.method === 'POST').length).toBe(1);
    });
  });
});
