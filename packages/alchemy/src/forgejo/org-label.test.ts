/**
 * `Forgejo.OrgLabel`'s `fetchLive` against a fake Forgejo — the "list, then find by name" pattern
 * (labels, teams, hooks and org secrets all share it, since Gitea addresses them by numeric id,
 * not name). Two absent cases fold to `undefined` the same way, for different reasons:
 *
 * - the org itself is gone: `orgListLabels` answers a real distilled `NotFound` (404), caught by
 *   the same `catchTag('NotFound', ...)` idiom every `fetchLive` in this family ends with.
 * - the org exists but has no label by that name: the list call succeeds, and `.find()` returns
 *   `undefined` on its own — no error, let alone a typed one, is involved.
 *
 * A 401 on the list still propagates unfolded, same as repository.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeForgejo, fakeForgejoLayer } from './fake-forgejo.ts';
import { spec } from './org-label.ts';

const LABELS_PATH = '/api/v1/orgs/homeflare/labels';

const fetchLabel = (fetchFn: typeof globalThis.fetch, name: string) =>
  organization.orgListLabels({ limit: 200, org: 'homeflare' }).pipe(
    Effect.map((rows) => rows.find((row) => row.name === name)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    Effect.provide(fakeForgejoLayer(fetchFn)),
  );

describe('Forgejo.OrgLabel fetchLive', () => {
  test('a live label matched by name decodes into the typed row', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === LABELS_PATH
        ? Response.json([{ color: 'ff0000', id: 7, name: 'bug' }])
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(fetchLabel(fake.fetch, 'bug'));
    expect(live?.id).toBe(7);
  });

  test('a name absent from a successful list is undefined — no error at all', async () => {
    const fake = fakeForgejo(() => Response.json([{ color: 'ff0000', id: 7, name: 'bug' }]));
    const live = await Effect.runPromise(fetchLabel(fake.fetch, 'enhancement'));
    expect(live).toBeUndefined();
  });

  test('the org itself missing (404 on the list) folds to undefined too', async () => {
    const fake = fakeForgejo(() => fakeFailure(404, 'org does not exist'));
    const live = await Effect.runPromise(fetchLabel(fake.fetch, 'bug'));
    expect(live).toBeUndefined();
  });

  test('a 401 on the list propagates — never folded to absent', async () => {
    // ⚠️ 401 rather than 403: `orgListLabels` only declares `NotFound` beyond the shared default
    //   channel — Unauthorized is in that shared set for every operation regardless.
    const fake = fakeForgejo(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(Effect.flip(fetchLabel(fake.fetch, 'bug')));
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('Forgejo.OrgLabel spec — the actual exported production functions', () => {
  // ⛔ Proves the real `fetchLive` + `attributes` in org-label.ts, not a parallel
  //   reimplementation — see the same note in repository.test.ts.
  const props = { color: 'ff0000', name: 'bug', org: 'homeflare' };

  const readThrough = (fetchFn: typeof globalThis.fetch) =>
    Effect.runPromise(
      spec.fetchLive(props).pipe(
        Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
        Effect.provide(fakeForgejoLayer(fetchFn)),
      ),
    );

  test('spec.fetchLive + spec.attributes match the old field mapping', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === LABELS_PATH
        ? Response.json([
            { color: 'FF0000', description: 'something is broken', id: 7, name: 'bug' },
          ])
        : fakeFailure(404, 'not found'),
    );
    // ⚠️ `color()` lowercases — the wire value `FF0000` must compare equal to the declared `ff0000`.
    expect(await readThrough(fake.fetch)).toEqual({
      color: 'ff0000',
      description: 'something is broken',
      exclusive: false,
      labelId: 7,
      name: 'bug',
      org: 'homeflare',
    });
  });

  test('a label absent from the list through spec.fetchLive is undefined', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === LABELS_PATH
        ? Response.json([{ color: '00ff00', id: 9, name: 'enhancement' }])
        : fakeFailure(404, 'not found'),
    );
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});
