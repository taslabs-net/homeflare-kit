/**
 * Regression suite for the PR 163 red-team HIGH finding, re-proved against
 * `@distilled.cloud/paperless-ngx`'s real wire path: `diff`/`reconcile` re-derived identity from
 * `news` alone on every call, so renaming (or re-owning) an already-deployed Tag missed the row
 * it previously wrote, POSTed a second object under the new name/owner, and left the original
 * permanently orphaned — while `diff` reported a plain `{action:'update'}`. See `matching.ts`'s
 * header and `matching-locate.ts`'s `fetchLive` for the fix: once `output` is defined, identity
 * is `output.id`, not `(name, owner)`.
 *
 * "Someone else changed the live row out of band" is simulated with the SDK's own
 * `tags.updateTagsPartial`/`tags.tagsDestroy` against the fake, not an internal escape hatch —
 * this package no longer has one after the `client.ts` removal, and calling the real production
 * functions is the more faithful simulation anyway.
 */
import { describe, expect, test } from 'bun:test';
import * as tags from '@distilled.cloud/paperless-ngx/tags';
import { fakePaperless, run } from './fake-paperless.ts';
import { matchingOperations } from './matching.ts';
import { spec } from './tag.ts';

const ops = matchingOperations(spec);
const writesOf = (fake: { seen: readonly { method: string }[] }) =>
  fake.seen.filter((s) => s.method !== 'GET');

describe('renaming or re-owning an already-deployed object (PR 163)', () => {
  test('a rename PATCHes the same id — no POST, no orphan', async () => {
    const fake = fakePaperless();
    const created = await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    const before = writesOf(fake).length;

    const renamed = await run(ops.reconcile({ name: 'Invoices - Renamed' }, created), fake.fetch);

    const writes = writesOf(fake);
    expect(writes.length).toBe(before + 1);
    expect(writes.slice(before).every((w) => w.method === 'PATCH')).toBe(true);
    expect(fake.rows('tags').length).toBe(1);
    expect(renamed?.id).toBe(created?.id);
    expect(renamed?.name).toBe('Invoices - Renamed');
  });

  test('an owner change PATCHes the same id — no POST, no orphan', async () => {
    const fake = fakePaperless();
    const created = await run(ops.reconcile({ name: 'Invoices', owner: 7 }, undefined), fake.fetch);
    const before = writesOf(fake).length;

    const reowned = await run(ops.reconcile({ name: 'Invoices', owner: 9 }, created), fake.fetch);

    expect(writesOf(fake).length).toBe(before + 1);
    expect(fake.rows('tags').length).toBe(1);
    expect(reowned?.id).toBe(created?.id);
    expect(reowned?.owner).toBe(9);
  });
});

describe('a deleted-out-of-band object (PR 163)', () => {
  test('diff refuses at plan rather than creating a replacement', async () => {
    const fake = fakePaperless();
    const created = await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    if (created === undefined) throw new Error('unreachable: reconcile always returns attrs');
    await run(tags.tagsDestroy({ id: created.id }), fake.fetch);

    await expect(run(ops.diff({ name: 'Invoices' }, created), fake.fetch)).rejects.toThrow(
      /no longer exists live|deleted out of band/,
    );
    expect(fake.rows('tags').length).toBe(0);
  });

  test('reconcile also refuses, not only diff, if called with no prior diff', async () => {
    const fake = fakePaperless();
    const created = await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    if (created === undefined) throw new Error('unreachable: reconcile always returns attrs');
    await run(tags.tagsDestroy({ id: created.id }), fake.fetch);

    await expect(run(ops.reconcile({ name: 'Invoices' }, created), fake.fetch)).rejects.toThrow(
      /no longer exists live|deleted out of band/,
    );
  });
});

describe('the no-state path is unaffected (PR 163)', () => {
  test('a first create still locates by name', async () => {
    const fake = fakePaperless();
    await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);

    const get = fake.seen.find((s) => s.method === 'GET');
    expect(get?.path).toContain('name__iexact=Invoices');
    expect(fake.seen.find((s) => s.method === 'POST')).toBeDefined();
  });

  test("adopt (output from the engine's own read) locates the id it read, no duplicate", async () => {
    const fake = fakePaperless();
    // A pre-existing object, created out of band — what `provider.read` (always called with
    // `output: undefined`) discovers during its adoption probe.
    await run(tags.createTag({ name: 'Invoices', owner: null }), fake.fetch);
    const readAttrs = await run(ops.read({ name: 'Invoices' }), fake.fetch);
    if (readAttrs === undefined) throw new Error('unreachable: asserted defined above');

    const after = await run(ops.reconcile({ name: 'Invoices' }, readAttrs), fake.fetch);

    expect(fake.rows('tags').length).toBe(1);
    expect(after?.id).toBe(readAttrs.id);
    expect(fake.seen.filter((s) => s.method === 'POST').length).toBe(1);
  });
});

describe('delete locates by output.id, not by (possibly stale) olds.name (re-review)', () => {
  test('a row renamed out of band is still found and deleted, by id', async () => {
    const fake = fakePaperless();
    const created = await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    if (created === undefined) throw new Error('unreachable: reconcile always returns attrs');

    await run(tags.updateTagsPartial({ id: created.id, name: 'Renamed Elsewhere' }), fake.fetch);
    await run(ops.destroy({ name: 'Invoices' }, created), fake.fetch);

    expect(fake.rows('tags').length).toBe(0);
    const deletes = fake.seen.filter((s) => s.method === 'DELETE');
    expect(deletes.length).toBe(1);
    expect(deletes[0]?.path).toBe(`/api/tags/${String(created.id)}/`);
  });

  test('with no output (no-state path), delete still falls back to locating by name', async () => {
    const fake = fakePaperless();
    await run(ops.reconcile({ name: 'Invoices' }, undefined), fake.fetch);
    await run(ops.destroy({ name: 'Invoices' }, undefined), fake.fetch);
    expect(fake.rows('tags').length).toBe(0);
  });
});
