/**
 * `Forgejo.TeamMember` — one user in one organization team.
 *
 * ★ WHY IT EXISTS: forgejo-provision, the service account the Forgejo engine mints as, belongs to the
 *   HomeFlare Owners team — Tim, 2026-09-14. Membership is what its tokens can reach; the role's
 *   scopes only cap it (<estate>/openbao/src/forgejo-bootstrap.ts).
 *
 * ★ READ OFF THE LIVE 16.0.3 SWAGGER (127.0.0.1:3000/swagger.v1.json, 2026-09-14): GET, PUT and
 *   DELETE `/teams/{id}/members/{username}` answer 200, 204 and 204, and 404 when absent. Now
 *   `organization.orgListTeamMember` / `orgAddTeamMember` / `orgRemoveTeamMember`; the team is
 *   still addressed by numeric id, found by name first via `orgListTeams` — the same seam as
 *   org-team.ts.
 *
 * ⚠️ EXISTENCE IS THE WHOLE OBJECT. Nothing about a membership can be updated, so `matches` is
 *   always true; a different team or user is a different resource id in alchemy.run.ts.
 *
 * ⚠️ THE TEAM ITSELF IS ONLY LOCATED HERE, NEVER MANAGED. A missing team fails the plan by name
 *   instead of folding into "absent" — `ForgejoTeamNotFoundError` is this family's own domain
 *   error, not one of the distilled SDK's typed HTTP errors, so the `catchTag('NotFound', ...)`
 *   at the end of `fetchLive` below (see resource.ts's header for why every `fetchLive` folds its
 *   own `NotFound` rather than one shared helper) never touches it. A PUT can add a member but
 *   cannot create a team.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO ADD OR REMOVE, and an identity allowed to manage the team.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — FOUND 2026-09-25 by reading the source, not by measuring
 *   anything (mini PR 82's red team, `homeflare-mini` 970e8be): before this, `ForgejoRepository`/
 *   `ForgejoOrgLabel` defaulted to retain in the kit itself but this family did not, so alchemy's
 *   own engine fallback (`destroy`) applied to it — every caller had to remember its own
 *   `.pipe(RemovalPolicy.retain())`, the way mini's `src/forgejo/declare.ts` did for
 *   `forgejo-provision`'s row. Dropping a `TeamMember` declaration — toggling a feature gate off,
 *   renaming the resource id — must not silently call `organization.orgRemoveTeamMember` and
 *   revoke a real membership; that is the same "removal from the stack is not removal from
 *   Forgejo" posture `ForgejoOrgLabel` and `ForgejoBranchProtection` already take, this family
 *   exists to attach a stack's identity to a team it never creates or destroys (`teamIdOf` below
 *   only ever locates the team, never manages it), and the same trade-off alchemy's own
 *   `GitHub.Collaborator` and `GitHub.TeamAccess` make for the identical reason — "preventing
 *   accidental lockout" (`GitHub/Collaborator.ts:127`, `GitHub/TeamAccess.ts:145` in the pinned
 *   alchemy source). The trade-off, stated plainly: removing a declaration no longer revokes
 *   access on its own — the plan shows that row as `orphaned`, not `delete`. Opt into a real
 *   revoke with `.pipe(RemovalPolicy.destroy())`; `destroy` below is fully implemented.
 *
 * ⚠️ THE DEFAULT ONLY PROTECTS A ROW ALREADY IN STATE ONCE THIS RELEASE IS DEPLOYED. Alchemy's
 *   plan reads `removalPolicy` off the *persisted row* (`Plan.ts`'s delete-node builder), not off
 *   this default; the default only reaches an existing row's state on a deploy where the resource
 *   plans as a no-op (`Apply.ts`'s noop path rewrites it and logs "removal policy destroy →
 *   retain"). A consumer that bumps to this release and drops a `TeamMember` declaration in the
 *   SAME deploy still gets `delete`, not `orphaned` — see the changeset for the two-deploy shape
 *   this implies for both adopting retain and opting back into destroy.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, type ForgejoSpec, forgejoHandlers } from './resource.ts';

export interface TeamMemberProps {
  org: string;
  /** Team name as Forgejo shows it, e.g. `Owners`. */
  team: string;
  username: string;
}

export interface TeamMemberAttributes {
  org: string;
  team: string;
  teamId: number;
  username: string;
}

export interface ForgejoTeamMember extends Resource<
  'Forgejo.TeamMember',
  TeamMemberProps,
  TeamMemberAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoTeamMember = Resource<ForgejoTeamMember>('Forgejo.TeamMember', {
  defaultRemovalPolicy: 'retain',
});

export class ForgejoTeamNotFoundError extends Data.TaggedError('ForgejoTeamNotFoundError')<{
  readonly message: string;
}> {}

interface TeamMemberLive {
  readonly teamId: number;
  readonly login: string;
}

const teamIdOf = (props: TeamMemberProps) =>
  organization.orgListTeams({ org: props.org, limit: 200 }).pipe(
    Effect.flatMap((rows) => {
      const id = rows.find((row) => row.name === props.team)?.id;
      return id === undefined
        ? Effect.fail(
            new ForgejoTeamNotFoundError({
              message: `no team named ${props.team} in org ${props.org}`,
            }),
          )
        : Effect.succeed(id);
    }),
  );

/** ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see repository.ts. */
export const spec: ForgejoSpec<
  TeamMemberProps,
  TeamMemberLive,
  TeamMemberAttributes,
  | organization.OrgAddTeamMemberError
  | organization.OrgRemoveTeamMemberError
  | organization.OrgListTeamMemberError
  | organization.OrgListTeamsError
  | ForgejoTeamNotFoundError
> = {
  attributes: (live, props) => {
    if (live.login.toLowerCase() !== props.username.toLowerCase()) return undefined;
    return { org: props.org, team: props.team, teamId: live.teamId, username: props.username };
  },
  destroy: (props, live) =>
    organization.orgRemoveTeamMember({ id: live.teamId, username: props.username }),
  fetchLive: (props) =>
    Effect.gen(function* () {
      const teamId = yield* teamIdOf(props);
      const user = yield* organization.orgListTeamMember({ id: teamId, username: props.username });
      return { login: user.login, teamId };
    }).pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: () => true,
  upsert: (props, before) =>
    before !== undefined
      ? Effect.void
      : Effect.flatMap(teamIdOf(props), (id) =>
          Effect.asVoid(organization.orgAddTeamMember({ id, username: props.username })),
        ),
};

export const handlers = forgejoHandlers(spec);

export const ForgejoTeamMemberProvider = () =>
  Provider.effect(ForgejoTeamMember, Effect.succeed(ForgejoTeamMember.Provider.of(handlers)));
