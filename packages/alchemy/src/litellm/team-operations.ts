/**
 * The seven LiteLLM `/team/*` calls `LiteLLM.Team` uses, through the SDK's typed operations in
 * `@distilled.cloud/litellm/team_management` (LiteLLM 1.103.0):
 *
 *   read    `getTeamInfoTeamInfo`                  GET  /team/info?team_id=
 *   list    `listTeamTeamListGet`                  GET  /team/list            (only to confirm a delete)
 *   create  `postNewTeamTeamNew`                   POST /team/new
 *   update  `updateTeamTeamUpdatePost`             POST /team/update
 *   add     `teamMemberAddTeamMemberAddPost`       POST /team/member_add
 *   role    `teamMemberUpdateTeamMemberUpdatePost` POST /team/member_update
 *   delete  `deleteTeamTeamDeletePost`             POST /team/delete
 *
 * ⛔ A "NOT FOUND" FROM `/team/info` IS NOT PROOF OF ABSENCE. Its lookup sits in `try … except Exception:
 *   raise HTTPException(404)` (`team_endpoints.py`, 1.103.0), so a database error answers exactly like a
 *   missing team, and `/team/delete` does the same. The SDK declares no 404 for `/team/info`; a 404
 *   decodes at run time as its `NotFound` class, which `readTeam` tests by CLASS (registry-support.ts,
 *   never a message). A wrong "absent" can only end in a `create`, which a duplicate team id turns into a
 *   400 that fails the deploy; nothing is written on a guess.
 * ⛔ DELETE DELETES THE TEAM'S KEYS (`delete_team`, `team_endpoints.py` line 4258: "delete team and associated team
 *   keys", and `prisma_client.delete_data(team_id_list=…, table_name="key")` at line 4374). It is the single most destructive
 *   call in this family, and the reason the resource defaults to `retain`.
 * ★ DELETE IS IDEMPOTENT ONLY AFTER A REAL READ THAT CANNOT LIE. The SDK types `NotFound` for
 *   `/team/delete` (a distilled patch), so it is caught with `catchTag`; but the route's own 404 also
 *   covers a database error, so success is reported only when `/team/list` (a `find_many`, whose
 *   failures are not swallowed) no longer has the id. A team still listed re-raises the ORIGINAL error.
 */
import * as team from '@distilled.cloud/litellm/team_management';
import * as Effect from 'effect/Effect';
import { throughFetch } from './operations.ts';
import { asRow, bodyOf, isNotFound } from './registry-support.ts';
import { toAttributes } from './team-form.ts';
import type { TeamMember } from './team-types.ts';

/** One team BY ID, or `undefined` when the proxy has no such team (see the file header). */
export const readTeam = (teamId: string) =>
  throughFetch(team.getTeamInfoTeamInfo({ team_id: teamId })).pipe(
    Effect.map((response) => {
      const row = toAttributes(bodyOf(response));
      return row?.teamId === teamId ? row : undefined;
    }),
    Effect.catch((error) => (isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error))),
  );

export const createTeam = (body: team.PostNewTeamTeamNewRequest) =>
  throughFetch(team.postNewTeamTeamNew(body)).pipe(Effect.asVoid);

export const updateTeam = (body: team.UpdateTeamTeamUpdatePostRequest) =>
  throughFetch(team.updateTeamTeamUpdatePost(body)).pipe(Effect.asVoid);

/** One call adds every missing member; LiteLLM skips a user already on the roster. */
export const addMembers = (teamId: string, members: readonly TeamMember[]) =>
  throughFetch(
    team.teamMemberAddTeamMemberAddPost({
      member: members.map((member) => ({ role: member.role ?? 'user', user_id: member.userId })),
      team_id: teamId,
    }),
  ).pipe(Effect.asVoid);

export const setMemberRole = (teamId: string, member: TeamMember) =>
  throughFetch(
    team.teamMemberUpdateTeamMemberUpdatePost({
      role: member.role ?? 'user',
      team_id: teamId,
      user_id: member.userId,
    }),
  ).pipe(Effect.asVoid);

/** Every team id on the proxy. ⚠️ HEAVY: `/team/list` also loads each team's keys. Used only on the delete path. */
const listTeamIds = () =>
  throughFetch(team.listTeamTeamListGet({})).pipe(
    Effect.map((response) => {
      const rows: unknown = bodyOf(response);
      return Array.isArray(rows)
        ? rows.flatMap((row) => {
            const id = asRow(row)?.['team_id'];
            return typeof id === 'string' ? [id] : [];
          })
        : [];
    }),
  );

export const deleteTeam = (teamId: string) =>
  throughFetch(team.deleteTeamTeamDeletePost({ team_ids: [teamId] })).pipe(
    Effect.asVoid,
    Effect.catchTag('NotFound', (original) =>
      listTeamIds().pipe(
        Effect.flatMap((ids) => (ids.includes(teamId) ? Effect.fail(original) : Effect.void)),
      ),
    ),
  );
