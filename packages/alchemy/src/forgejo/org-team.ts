/**
 * `Forgejo.OrgTeam` — one organization team under `/orgs/{org}/teams`.
 *
 * ★ READ OFF `<estate>/mcp-servers/docs/api/upstream/forgejo.json` (Forgejo 16.x OpenAPI): create is
 *   `POST /orgs/{org}/teams`; read/update/delete use numeric id at `/teams/{id}` — not the name.
 *   Now `organization.orgCreateTeam` / `orgListTeams` / `orgEditTeam` / `orgDeleteTeam`.
 *
 * ⚠️ `orgEditTeam`/`orgDeleteTeam` TAKE ONLY `{ id, ... }` — NO `org` FIELD. The package's schema
 *   confirms Forgejo's edit/delete routes are `/teams/{id}` with no org segment; `fetchLive` lists
 *   by name and `update`/`destroy` carry the id off that row, same seam as org labels.
 *
 * ⚠️ `live.permission` IS TYPED `"none" | "read" | "write" | "admin" | "owner"` IN THE PACKAGE —
 *   wider than this family's own `TeamPermission`. The guard below keeps the original behaviour:
 *   an out-of-range value (`none`/`owner`) folds `attributes` to `undefined` rather than lying
 *   about which of the three this family manages the team is at.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO CREATE OR PATCH — read list/get needs `read:organization`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as organization from '@distilled.cloud/forgejo/organization';
import * as Effect from 'effect/Effect';
import { type ForgejoRequirements, type ForgejoSpec, forgejoHandlers } from './resource.ts';
import { recordEqual, stringArray, stringRecord } from './values.ts';

export type TeamPermission = 'read' | 'write' | 'admin';

export interface OrgTeamProps {
  org: string;
  /** Team name — primary locate key; sent on every edit body. */
  name: string;
  description?: string;
  permission?: TeamPermission;
  units?: string[];
  unitsMap?: Record<string, string>;
  includesAllRepositories?: boolean;
  canCreateOrgRepo?: boolean;
}

export interface OrgTeamAttributes {
  org: string;
  name: string;
  teamId: number;
  description: string;
  permission: TeamPermission;
  units: string[];
  unitsMap: Record<string, string>;
  includesAllRepositories: boolean;
  canCreateOrgRepo: boolean;
}

export interface ForgejoOrgTeam extends Resource<
  'Forgejo.OrgTeam',
  OrgTeamProps,
  OrgTeamAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoOrgTeam = Resource<ForgejoOrgTeam>('Forgejo.OrgTeam');

const teamForm = (props: OrgTeamProps) => ({
  can_create_org_repo: props.canCreateOrgRepo ?? false,
  description: props.description ?? '',
  includes_all_repositories: props.includesAllRepositories ?? false,
  name: props.name,
  ...(props.permission === undefined ? {} : { permission: props.permission }),
  ...(props.units === undefined ? {} : { units: props.units }),
  ...(props.unitsMap === undefined ? {} : { units_map: props.unitsMap }),
});

/** ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see repository.ts. */
export const spec: ForgejoSpec<
  OrgTeamProps,
  organization.Team,
  OrgTeamAttributes,
  | organization.OrgCreateTeamError
  | organization.OrgEditTeamError
  | organization.OrgDeleteTeamError
  | organization.OrgListTeamsError
> = {
  attributes: (live, props) => {
    const permission = live.permission ?? 'read';
    if (permission !== 'read' && permission !== 'write' && permission !== 'admin') return undefined;
    return {
      canCreateOrgRepo: live.can_create_org_repo ?? false,
      description: live.description ?? '',
      includesAllRepositories: live.includes_all_repositories ?? false,
      name: props.name,
      org: props.org,
      permission,
      teamId: live.id,
      units: stringArray(live.units ?? []),
      unitsMap: stringRecord(live.units_map ?? {}),
    };
  },
  create: (props) => organization.orgCreateTeam({ org: props.org, ...teamForm(props) }),
  destroy: (_props, live) => organization.orgDeleteTeam({ id: live.id }),
  fetchLive: (props) =>
    organization.orgListTeams({ org: props.org, limit: 200 }).pipe(
      Effect.map((rows) => rows.find((row) => row.name === props.name)),
      Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
    ),
  matches: (attributes, props) =>
    attributes.description === (props.description ?? '') &&
    attributes.permission === (props.permission ?? 'read') &&
    attributes.includesAllRepositories === (props.includesAllRepositories ?? false) &&
    attributes.canCreateOrgRepo === (props.canCreateOrgRepo ?? false) &&
    (props.units === undefined ||
      stringArray(props.units).join('\0') === attributes.units.join('\0')) &&
    (props.unitsMap === undefined || recordEqual(attributes.unitsMap, props.unitsMap)),
  update: (props, live) => organization.orgEditTeam({ id: live.id, ...teamForm(props) }),
};

export const handlers = forgejoHandlers(spec);

export const ForgejoOrgTeamProvider = () =>
  Provider.effect(ForgejoOrgTeam, Effect.succeed(ForgejoOrgTeam.Provider.of(handlers)));
