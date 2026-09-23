/**
 * `matching.ts`'s generic lifecycle against a fake Paperless: owner injection, the version
 * header, 403-never-absent, case-sensitive identity inside a case-insensitive locate, and
 * Unowned-on-every-match (H1).
 *
 * ⛔ THESE TESTS FAIL WITHOUT THE UNIT. `matching.ts`, `client.ts`, `credentials.ts` and
 *   `errors.ts` did not exist before this change — there was nothing to import.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { describe, expect, test } from 'bun:test';
import { run, runFailure, withFake } from './fake-paperless.ts';
import { type MatchingProps, matchingHandlers, matchingOperations } from './matching.ts';

interface Props extends MatchingProps {
  note?: string;
}
/** ★ A minimal spec — this file tests `matching.ts`'s own contract, not any one family's wiring. */
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

describe('create always carries owner, null when undeclared', () => {
  test('a create with no owner prop sends owner: null', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      await run(handlers.reconcile({ news: { name: 'Invoices' } }));
      const post = fake.seen.find((s) => s.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ name: 'Invoices', owner: null });
    });
  });

  test('a create with an owner prop sends that owner', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      await run(handlers.reconcile({ news: { name: 'Receipts', owner: 7 } }));
      const post = fake.seen.find((s) => s.method === 'POST');
      expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ owner: 7 });
    });
  });
});

test('every request carries Accept: application/json; version=10', async () => {
  await withFake(async (fake) => {
    const handlers = matchingHandlers(spec);
    await run(handlers.reconcile({ news: { name: 'Invoices' } }));
    expect(fake.seen.length).toBeGreaterThan(0);
    for (const call of fake.seen) {
      expect(call.headers.get('Accept')).toBe('application/json; version=10');
    }
  });
});

test('a no-drift reconcile makes zero writes', async () => {
  await withFake(async (fake) => {
    const handlers = matchingHandlers(spec);
    await run(handlers.reconcile({ news: { name: 'Invoices' } }));
    const before = fake.seen.filter((s) => s.method !== 'GET').length;
    await run(handlers.reconcile({ news: { name: 'Invoices' } }));
    const after = fake.seen.filter((s) => s.method !== 'GET').length;
    expect(after).toBe(before);
  });
});

test('a 403 fails rather than reading as absent', async () => {
  await withFake(async (fake) => {
    const ops = matchingOperations(spec);
    fake.forceStatus = 403;
    const error = await runFailure(ops.read({ name: 'Invoices' }));
    expect((error as { _tag?: string })._tag).toBe('PaperlessUnauthorized');
  });
});

test('a 404 on read folds to absent (create is the right plan)', async () => {
  await withFake(async () => {
    const ops = matchingOperations(spec);
    expect(await run(ops.read({ name: 'Nothing here' }))).toBeUndefined();
  });
});

describe('case-insensitive locate, case-sensitive identity', () => {
  test('two differently-cased names never collapse into one object', async () => {
    await withFake(async (fake) => {
      const handlers = matchingHandlers(spec);
      await run(handlers.reconcile({ news: { name: 'Invoices' } }));
      await run(handlers.reconcile({ news: { name: 'invoices' } }));
      expect(fake.rows('tags').length).toBe(2);

      const ops = matchingOperations(spec);
      const exact = await run(ops.read({ name: 'Invoices' }));
      expect(exact?.name).toBe('Invoices');
      const other = await run(ops.read({ name: 'invoices' }));
      expect(other?.name).toBe('invoices');
    });
  });
});

test('read answers Unowned on a match, even one identical to the declaration (H1)', async () => {
  await withFake(async () => {
    const handlers = matchingHandlers(spec);
    await run(handlers.reconcile({ news: { name: 'Invoices' } }));
    const result = await run(handlers.read({ olds: { name: 'Invoices' } }));
    expect(result).toBeDefined();
    expect(Unowned.is(result)).toBe(true);
  });
});

test('read answers undefined, not Unowned, when nothing matches', async () => {
  await withFake(async () => {
    const handlers = matchingHandlers(spec);
    expect(await run(handlers.read({ olds: { name: 'Nothing here' } }))).toBeUndefined();
  });
});
