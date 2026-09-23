/**
 * `Forgejo.Repository`'s `fetchLive` against a fake Forgejo, proving the tagged-error paths that
 * replaced `client.ts`'s status-carrying `ForgejoError`:
 *
 * - a real distilled `NotFound` (HTTP 404) folds to `undefined` — resource.ts's engine sees the
 *   repository as absent, the same outcome the old `absentOn404` produced for a 404.
 * - a real distilled `Forbidden` (HTTP 403) is NOT folded — it fails the read, because folding it
 *   would plan a create over a repository this token simply cannot see.
 *
 * Both run the REAL `@distilled.cloud/forgejo` protocol (path assembly, JSON decode, status→typed
 * error matching) against an in-memory `fetch`; nothing about the matching is asserted by hand.
 */
import { describe, expect, test } from 'bun:test';
import * as repository from '@distilled.cloud/forgejo/repository';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, fakeFailure, fakeForgejo, fakeForgejoLayer } from './fake-forgejo.ts';
import { spec } from './repository.ts';

const REPO_PATH = '/api/v1/repos/homeflare/kit';

const liveRepo = () =>
  Response.json({
    clone_url: `${FAKE_BASE}/homeflare/kit.git`,
    created_at: '2026-01-01T00:00:00Z',
    default_branch: 'main',
    description: 'the kit',
    full_name: 'homeflare/kit',
    has_issues: true,
    has_projects: true,
    has_wiki: false,
    html_url: `${FAKE_BASE}/homeflare/kit`,
    id: 42,
    name: 'kit',
    owner: { id: 1, login: 'homeflare' },
    private: true,
    ssh_url: 'git@forgejo.example.com:homeflare/kit.git',
    updated_at: '2026-01-01T00:00:00Z',
  });

describe('Forgejo.Repository fetchLive', () => {
  test('a live repository decodes into typed attributes', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === REPO_PATH ? liveRepo() : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      repository
        .getRepo({ owner: 'homeflare', repo: 'kit' })
        .pipe(Effect.provide(fakeForgejoLayer(fake.fetch))),
    );
    expect(live.id).toBe(42);
    expect(live.has_wiki).toBe(false);
    expect(fake.seen).toEqual([{ method: 'GET', path: REPO_PATH }]);
  });

  test('a 404 folds to undefined — the exact `fetchLive` idiom repository.ts uses', async () => {
    // ⚠️ This is the same one-line `.pipe(Effect.catchTag('NotFound', ...))` repository.ts's
    //   `fetchLive` ends with, exercised against a real distilled decode of a real 404 response —
    //   the direct successor to client.ts's `absentOn404` folding a raw HTTP 404.
    const fake = fakeForgejo(() => fakeFailure(404, 'repository does not exist'));
    const result = await Effect.runPromise(
      repository.getRepo({ owner: 'homeflare', repo: 'ghost' }).pipe(
        Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
        Effect.provide(fakeForgejoLayer(fake.fetch)),
      ),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — Unauthorized is a real failure, never folded to absent', async () => {
    // ⚠️ 401 rather than 403: `getRepo`'s own declared errors are only `NotFound` (plus the
    //   channel every operation shares) — Unauthorized is in that shared default set, decoded
    //   for every operation regardless of what it declares, so this does not depend on
    //   `getRepo` happening to also list Forbidden.
    const fake = fakeForgejo(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(
        repository.getRepo({ owner: 'homeflare', repo: 'kit' }).pipe(
          Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
          Effect.provide(fakeForgejoLayer(fake.fetch)),
        ),
      ),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('Forgejo.Repository spec — the actual exported production functions', () => {
  // ⛔ THE POINT OF THIS BLOCK. The describe above proves the SDK's own `getRepo` +
  //   `catchTag('NotFound', ...)` idiom works; it does not touch a single line of
  //   repository.ts. This block calls `spec.fetchLive` and `spec.attributes` — the exact object
  //   `forgejoHandlers(spec)` wraps into `ForgejoRepositoryProvider` — so a typo that dropped or
  //   mistagged the `catchTag` in `fetchLive`, or a drifted `attributes()` mapping, fails HERE.
  const props = { name: 'kit', org: 'homeflare' };

  const readThrough = (fetchFn: typeof globalThis.fetch) =>
    Effect.runPromise(
      spec.fetchLive(props).pipe(
        Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
        Effect.provide(fakeForgejoLayer(fetchFn)),
      ),
    );

  test('spec.fetchLive + spec.attributes match the old field mapping', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === REPO_PATH ? liveRepo() : fakeFailure(404, 'not found'),
    );
    expect(await readThrough(fake.fetch)).toEqual({
      defaultBranch: 'main',
      description: 'the kit',
      empty: false,
      hasIssues: true,
      hasProjects: true,
      hasWiki: false,
      name: 'kit',
      org: 'homeflare',
      private: true,
      repoId: 42,
    });
  });

  test('a 404 through spec.fetchLive is undefined, not a thrown failure', async () => {
    const fake = fakeForgejo(() => fakeFailure(404, 'repository does not exist'));
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});
