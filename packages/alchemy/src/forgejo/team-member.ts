/**
 * `Forgejo.TeamMember` — one user in one organization team.
 *
 * ★ WHY IT EXISTS: forgejo-provision, the service account the Forgejo engine mints as, belongs to the
 *   HomeFlare Owners team — Tim, 2026-09-14. Membership is what its tokens can reach; the role's
 *   scopes only cap it (<estate>/openbao/src/forgejo-bootstrap.ts).
 *
 * ★ READ OFF THE LIVE 16.0.3 SWAGGER (127.0.0.1:3000/swagger.v1.json, 2026-09-14): GET, PUT and
 *   DELETE `/teams/{id}/members/{username}` answer 200, 204 and 204, and 404 when absent. The team
 *   is addressed by numeric id, so it is found by name first — the same seam as org-team.ts.
 *
 * ⚠️ EXISTENCE IS THE WHOLE OBJECT. Nothing about a membership can be updated, so `matches` is
 *   always true; a different team or user is a different resource id in alchemy.run.ts.
 *
 * ⚠️ THE TEAM ITSELF IS ONLY LOCATED HERE, NEVER MANAGED. A missing team fails the plan by name
 *   instead of folding into "absent", because a PUT can add a member but cannot create a team.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO ADD OR REMOVE, and an identity allowed to manage the team.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { ForgejoError, forgejo } from './client.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';

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

export const ForgejoTeamMember = Resource<ForgejoTeamMember>('Forgejo.TeamMember');

/** Where `locate` leaves the team id on the live row, for `attributes` and `wirePath`. */
const TEAM_ID = '__team_id';

const teamIdOf = (props: TeamMemberProps) =>
  Effect.gen(function* () {
    const path = `orgs/${props.org}/teams?limit=200`;
    const rows = yield* forgejo<Record<string, unknown>[]>('GET', path);
    const id = (Array.isArray(rows) ? rows : []).find((row) => row['name'] === props.team)?.['id'];
    if (typeof id !== 'number') {
      return yield* Effect.fail(
        new ForgejoError(0, 'GET', path, `no team named ${props.team} in org ${props.org}`),
      );
    }
    return id;
  });

const memberPath = (id: number, props: TeamMemberProps) =>
  `teams/${String(id)}/members/${props.username}`;

const handlers = forgejoHandlers<TeamMemberProps, TeamMemberAttributes>({
  attributes: (live, props) => {
    const id = live[TEAM_ID];
    const login = live['login'];
    if (typeof id !== 'number' || typeof login !== 'string') return undefined;
    if (login.toLowerCase() !== props.username.toLowerCase()) return undefined;
    return { org: props.org, team: props.team, teamId: id, username: props.username };
  },
  collection: (props) => `orgs/${props.org}/teams`,
  createForm: () => ({}),
  locate: (props) =>
    Effect.gen(function* () {
      const id = yield* teamIdOf(props);
      const user = yield* forgejo<Record<string, unknown>>('GET', memberPath(id, props));
      return user === undefined ? undefined : { ...user, [TEAM_ID]: id };
    }),
  matches: () => true,
  path: (props) => `orgs/${props.org}/teams/${props.team}/members/${props.username}`,
  upsert: (props, before) =>
    before !== undefined
      ? Effect.void
      : Effect.flatMap(teamIdOf(props), (id) =>
          Effect.asVoid(forgejo('PUT', memberPath(id, props))),
        ),
  wirePath: (props, live) => memberPath(Number(live[TEAM_ID]), props),
});

export const ForgejoTeamMemberProvider = () =>
  Provider.effect(ForgejoTeamMember, Effect.succeed(ForgejoTeamMember.Provider.of(handlers)));
