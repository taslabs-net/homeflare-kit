/**
 * `Forgejo.TeamMember`'s `fetchLive`: the one family in this set where a resource-level domain
 * error (`ForgejoTeamNotFoundError` — "no team named X", not from the distilled SDK) sits
 * alongside the SDK's own `NotFound`. Proves the two stay distinct: only the SDK's tag folds.
 */
import { describe, expect, test } from 'bun:test';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeForgejo, fakeForgejoLayer } from './fake-forgejo.ts';
import { ForgejoTeamNotFoundError } from './team-member.ts';

const TEAMS_PATH = '/api/v1/orgs/homeflare/teams';
const TEAMS_LIST_PATH = `${TEAMS_PATH}?limit=200`;
const MEMBER_PATH = (id: number) => `/api/v1/teams/${String(id)}/members/tim`;

const fetchMembership = (fetchFn: typeof globalThis.fetch, team: string) =>
  Effect.gen(function* () {
    const rows = yield* organization.orgListTeams({ limit: 200, org: 'homeflare' });
    const id = rows.find((row) => row.name === team)?.id;
    if (id === undefined) {
      return yield* Effect.fail(
        new ForgejoTeamNotFoundError({ message: `no team named ${team} in org homeflare` }),
      );
    }
    return yield* organization.orgListTeamMember({ id, username: 'tim' });
  }).pipe(
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    Effect.provide(fakeForgejoLayer(fetchFn)),
  );

describe('Forgejo.TeamMember fetchLive', () => {
  test('a member not on the team (404 on the membership GET) folds to undefined', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === TEAMS_PATH
        ? Response.json([{ id: 5, name: 'Owners' }])
        : fakeFailure(404, 'member not found'),
    );
    const result = await Effect.runPromise(fetchMembership(fake.fetch, 'Owners'));
    expect(result).toBeUndefined();
    expect(fake.seen.map((s) => s.path)).toEqual([TEAMS_LIST_PATH, MEMBER_PATH(5)]);
  });

  test('a team the org has no record of is a real failure, not absence', async () => {
    // ⛔ THE POINT OF THIS TEST. `ForgejoTeamNotFoundError` has its own `_tag` — it is not the
    //   SDK's `NotFound` — so the same `catchTag('NotFound', ...)` that just folded a missing
    //   membership above must NOT fold this. A team-name typo failing loudly beats it silently
    //   planning to add a member to a team that was never there.
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === TEAMS_PATH ? Response.json([]) : fakeFailure(404, 'x'),
    );
    const failure = await Effect.runPromise(Effect.flip(fetchMembership(fake.fetch, 'Ghosts')));
    expect(failure._tag).toBe('ForgejoTeamNotFoundError');
    expect(failure.message).toContain('Ghosts');
    expect(fake.seen.map((s) => s.path)).toEqual([TEAMS_LIST_PATH]);
  });
});
