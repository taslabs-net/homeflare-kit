/**
 * `Forgejo.OrgTeam` — one organization team under `/orgs/{org}/teams`.
 *
 * ★ READ OFF `<estate>/mcp-servers/docs/api/upstream/forgejo.json` (Forgejo 16.x OpenAPI): create is
 *   `POST /orgs/{org}/teams`; read/update/delete use numeric id at `/teams/{id}` — not the name.
 *
 * ⚠️ PATCH AND DELETE USE `/teams/{id}` — same seam as org labels. `locate` lists by name;
 *   `wirePath` carries the id from that row.
 *
 * ⛔ TOKEN NEEDS `write:organization` TO CREATE OR PATCH — read list/get needs `read:organization`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { forgejo } from './client.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { bool, recordEqual, stringArray, stringRecord, text } from './values.ts';

export type TeamPermission = 'read' | 'write' | 'admin';

export interface OrgTeamProps {
  org: string;
  /** Team name — primary locate key; sent on every PATCH body. */
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

const handlers = forgejoHandlers<OrgTeamProps, OrgTeamAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    const permission = text(live['permission'], 'read');
    if (permission !== 'read' && permission !== 'write' && permission !== 'admin') return undefined;
    return {
      canCreateOrgRepo: bool(live['can_create_org_repo']),
      description: text(live['description']),
      includesAllRepositories: bool(live['includes_all_repositories']),
      name: props.name,
      org: props.org,
      permission,
      teamId: id,
      units: stringArray(live['units']),
      unitsMap: stringRecord(live['units_map']),
    };
  },
  collection: (props) => `orgs/${props.org}/teams`,
  createForm: teamForm,
  locate: (props) =>
    forgejo<Record<string, unknown>[]>('GET', `orgs/${props.org}/teams?limit=200`).pipe(
      Effect.map((rows) =>
        Array.isArray(rows) ? rows.find((row) => row['name'] === props.name) : undefined,
      ),
    ),
  matches: (attributes, props) =>
    attributes.description === (props.description ?? '') &&
    attributes.permission === (props.permission ?? 'read') &&
    attributes.includesAllRepositories === (props.includesAllRepositories ?? false) &&
    attributes.canCreateOrgRepo === (props.canCreateOrgRepo ?? false) &&
    (props.units === undefined ||
      stringArray(props.units).join('\0') === attributes.units.join('\0')) &&
    (props.unitsMap === undefined || recordEqual(attributes.unitsMap, props.unitsMap)),
  path: (props) => `orgs/${props.org}/teams/${props.name}`,
  updateForm: teamForm,
  wirePath: (_props, live) => `teams/${String(live['id'])}`,
});

export const ForgejoOrgTeamProvider = () =>
  Provider.effect(ForgejoOrgTeam, Effect.succeed(ForgejoOrgTeam.Provider.of(handlers)));
