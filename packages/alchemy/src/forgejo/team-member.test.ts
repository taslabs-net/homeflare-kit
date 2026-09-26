/**
 * `Forgejo.TeamMember`'s `fetchLive`: the one family in this set where a resource-level domain
 * error (`ForgejoTeamNotFoundError` — "no team named X", not from the distilled SDK) sits
 * alongside the SDK's own `NotFound`. Proves the two stay distinct: only the SDK's tag folds.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeForgejo, fakeForgejoLayer } from './fake-forgejo.ts';
import { ForgejoTeamNotFoundError, spec } from './team-member.ts';

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

describe('Forgejo.TeamMember spec — the actual exported production functions', () => {
  // ⛔ Proves the real `fetchLive` + `attributes` in team-member.ts, not a parallel
  //   reimplementation — see the same note in repository.test.ts.
  const props = { org: 'homeflare', team: 'Owners', username: 'tim' };

  const readThrough = (fetchFn: typeof globalThis.fetch) =>
    Effect.runPromise(
      spec.fetchLive(props).pipe(
        Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
        Effect.provide(fakeForgejoLayer(fetchFn)),
      ),
    );

  test('a member on the team reads through spec.fetchLive + spec.attributes', async () => {
    const fake = fakeForgejo((method, url) => {
      if (method === 'GET' && url.pathname === TEAMS_PATH) {
        return Response.json([{ id: 5, name: 'Owners' }]);
      }
      if (method === 'GET' && url.pathname === MEMBER_PATH(5)) {
        return Response.json({ id: 99, login: 'tim' });
      }
      return fakeFailure(404, 'not found');
    });
    expect(await readThrough(fake.fetch)).toEqual({
      org: 'homeflare',
      team: 'Owners',
      teamId: 5,
      username: 'tim',
    });
  });

  test('a member not on the team through spec.fetchLive is undefined', async () => {
    const fake = fakeForgejo((method, url) =>
      method === 'GET' && url.pathname === TEAMS_PATH
        ? Response.json([{ id: 5, name: 'Owners' }])
        : fakeFailure(404, 'not a member'),
    );
    expect(await readThrough(fake.fetch)).toBeUndefined();
  });
});

test('ForgejoTeamMember declares defaultRemovalPolicy: retain on the Resource() call itself', () => {
  // ⛔ Anchored on the `Resource<ForgejoTeamMember>(...)` CALL, not on the substring appearing
  //   anywhere in the file — team-member.ts's own header comment also says the phrase in prose, so
  //   a plain `source.toContain(...)` (database-refusals.test.ts's simpler version, safe there
  //   because database.ts's header never repeats the phrase) would pass here even if the option
  //   were dropped from the actual call. mini PR 82's red team (970e8be) had to pipe
  //   `RemovalPolicy.retain()` onto every call site because the kit resource had no default; this
  //   proves the kit default carries the fix so a caller no longer has to remember its own.
  const source = readFileSync(new URL('./team-member.ts', import.meta.url), 'utf8');
  const call = source.match(/Resource<ForgejoTeamMember>\([\s\S]*?\);/);
  expect(call?.[0]).toContain("defaultRemovalPolicy: 'retain'");
});
