/**
 * `GoogleWorkspace.Group`'s `spec` against a fake Directory API — get-by-key, unlike NetBox's
 * list-then-disambiguate (resource.ts's own note on why this family never needs `locateOne`).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  fakeFailure,
  fakeGoogleWorkspace,
  fakeGoogleWorkspaceLayer,
} from './fake-google-workspace.ts';
import { spec } from './group.ts';

// ⚠️ `@` is percent-encoded by the SDK's own path-token encoder (`encodeURIComponent`), and
//   `URL#pathname` does not decode an already-encoded sequence back — match the wire form.
const GROUP_PATH = '/admin/directory/v1/groups/team%40schenanigans.com';
const props = { email: 'team@schenanigans.com', name: 'Team', description: 'the team' };

const readThrough = (fetchFn: typeof globalThis.fetch) =>
  Effect.runPromise(
    spec.fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
      Effect.provide(fakeGoogleWorkspaceLayer(fetchFn)),
    ),
  );

describe('GoogleWorkspace.Group spec.fetchLive + spec.attributes', () => {
  test('a live group decodes into the full attribute set — adopt(true) exact-as-live', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === GROUP_PATH
        ? Response.json({
            adminCreated: true,
            aliases: ['old-team@schenanigans.com'],
            description: 'the team',
            directMembersCount: '3',
            email: 'team@schenanigans.com',
            id: '01234567890',
            name: 'Team',
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    expect(await readThrough(fake.fetch)).toEqual({
      adminCreated: true,
      aliases: ['old-team@schenanigans.com'],
      description: 'the team',
      directMembersCount: '3',
      email: 'team@schenanigans.com',
      groupId: '01234567890',
      name: 'Team',
      nonEditableAliases: [],
    });
  });

  test('a 404 folds to undefined — the standard "not created yet" case', async () => {
    const fake = fakeGoogleWorkspace(() => fakeFailure(404, 'not found', 'NOT_FOUND'));
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });

  test('a 403 propagates unfolded — never treated as absent', async () => {
    const fake = fakeGoogleWorkspace(() => fakeFailure(403, 'forbidden', 'PERMISSION_DENIED'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGoogleWorkspaceLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('GoogleWorkspace.Group spec.matches', () => {
  const live = {
    adminCreated: false,
    aliases: [],
    description: 'the team',
    directMembersCount: '0',
    email: 'team@schenanigans.com',
    groupId: 'x',
    name: 'Team',
    nonEditableAliases: [],
  };

  test('declared description and name equal to live — no drift', () => {
    expect(spec.matches(live, props)).toBe(true);
  });

  test('a changed description is drift', () => {
    expect(spec.matches(live, { ...props, description: 'a different team' })).toBe(false);
  });

  test('an undeclared name converges to the email local-part deterministically', () => {
    const { name: _name, ...withoutName } = props;
    expect(spec.matches({ ...live, name: 'team' }, withoutName)).toBe(true);
    expect(spec.matches(live, withoutName)).toBe(false);
  });
});
