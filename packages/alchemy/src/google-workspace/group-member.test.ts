/**
 * `GoogleWorkspace.GroupMember`'s `spec` against a fake Directory API — unlike
 * `Forgejo.TeamMember`, this membership has mutable fields (`role`, `deliverySettings`), so
 * `matches` can see real drift, not just existence.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  fakeFailure,
  fakeGoogleWorkspace,
  fakeGoogleWorkspaceLayer,
} from './fake-google-workspace.ts';
import { spec } from './group-member.ts';

// ⚠️ `@` is percent-encoded by the SDK's own path-token encoder — match the wire form (see the
//   same note in group.test.ts).
const MEMBER_PATH =
  '/admin/directory/v1/groups/team%40schenanigans.com/members/tim%40schenanigans.com';
const props = {
  email: 'tim@schenanigans.com',
  group: 'team@schenanigans.com',
  role: 'OWNER' as const,
};

const readThrough = (fetchFn: typeof globalThis.fetch) =>
  Effect.runPromise(
    spec.fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
      Effect.provide(fakeGoogleWorkspaceLayer(fetchFn)),
    ),
  );

describe('GoogleWorkspace.GroupMember spec.fetchLive + spec.attributes', () => {
  test('a live member decodes with its role and delivery settings', async () => {
    const fake = fakeGoogleWorkspace((method, url) =>
      method === 'GET' && url.pathname === MEMBER_PATH
        ? Response.json({
            delivery_settings: 'ALL_MAIL',
            email: 'tim@schenanigans.com',
            id: 'member-1',
            role: 'OWNER',
            status: 'ACTIVE',
          })
        : fakeFailure(404, 'not found', 'NOT_FOUND'),
    );
    expect(await readThrough(fake.fetch)).toEqual({
      deliverySettings: 'ALL_MAIL',
      email: 'tim@schenanigans.com',
      group: 'team@schenanigans.com',
      memberId: 'member-1',
      role: 'OWNER',
      status: 'ACTIVE',
    });
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGoogleWorkspace(() => fakeFailure(404, 'not found', 'NOT_FOUND'));
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});

describe('GoogleWorkspace.GroupMember spec.matches — role and delivery drift', () => {
  const live = {
    deliverySettings: 'ALL_MAIL',
    email: 'tim@schenanigans.com',
    group: 'team@schenanigans.com',
    memberId: 'member-1',
    role: 'MEMBER',
    status: 'ACTIVE',
  };

  test('a declared role different from live is drift', () => {
    expect(spec.matches(live, props)).toBe(false);
  });

  test('the same role, and an undeclared deliverySettings converging to ALL_MAIL, is no drift', () => {
    expect(spec.matches({ ...live, role: 'OWNER' }, props)).toBe(true);
  });

  test('a declared deliverySettings different from live is drift even with a matching role', () => {
    expect(
      spec.matches(
        { ...live, deliverySettings: 'DIGEST', role: 'OWNER' },
        {
          ...props,
          deliverySettings: 'NONE',
        },
      ),
    ).toBe(false);
  });
});
