/**
 * Wire bodies, comparison and refusals for `LiteLLM.Team`, testable without a server. The object
 * permission is team-permission.ts, the roster team-members.ts.
 *
 * ★ THE UPDATE IS A PARTIAL ONE (`/team/update` builds its write from `data.json(exclude_unset=True)`,
 *   `team_endpoints.py` line 2418, 1.103.0), so it sends the team id and ONLY what differs. Nothing
 *   here sends `metadata`, a budget, a limit or any Enterprise field.
 * ★ THE READ IS `/team/info`, and it returns the team's OWN columns: access-group grants are resolved
 *   into separate `access_group_*` fields (`_resolve_team_access_group_resources`), never merged into
 *   `models` or `object_permission`, so a group cannot make a team look as if it declared a model.
 */
import type * as team from '@distilled.cloud/litellm/team_management';
import {
  asRow,
  canonical,
  firstBadEntry,
  firstDuplicate,
  isBlank,
  sameSet,
  stringsOf,
} from './registry-support.ts';
import { rosterPending, toMemberAttributes } from './team-members.ts';
import {
  permissionBody,
  permissionDiffers,
  permissionProblem,
  toPermissionAttributes,
} from './team-permission.ts';
import type { TeamAttributes, TeamProps } from './team-types.ts';

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: TeamProps): string | undefined => {
  if (isBlank(props.teamAlias) || props.teamAlias !== props.teamAlias.trim()) {
    return '`teamAlias` must be a non-blank name with no leading or trailing space';
  }
  if (
    props.teamId !== undefined &&
    (isBlank(props.teamId) || props.teamId !== props.teamId.trim())
  ) {
    return '`teamId` must be a non-blank id with no leading or trailing space';
  }
  for (const [field, values] of [
    ['models', props.models ?? []],
    ['accessGroupIds', props.accessGroupIds ?? []],
  ] as const) {
    const bad = firstBadEntry(values);
    if (bad !== undefined)
      return `\`${field}\` has a blank or padded entry (${JSON.stringify(bad)})`;
    const twice = firstDuplicate(values);
    if (twice !== undefined) return `\`${field}\` lists ${JSON.stringify(twice)} twice`;
  }
  const ids = (props.members ?? []).map((member) => member.userId);
  const badId = firstBadEntry(ids);
  if (badId !== undefined)
    return `\`members\` has a blank or padded userId (${JSON.stringify(badId)})`;
  const twiceId = firstDuplicate(ids);
  if (twiceId !== undefined) return `\`members\` lists ${JSON.stringify(twiceId)} twice`;
  for (const member of props.members ?? []) {
    if (member.role !== undefined && member.role !== 'user' && member.role !== 'admin') {
      return `member ${member.userId} has a role other than user or admin`;
    }
  }
  return permissionProblem(props.objectPermission);
};

/** One `team_info` row. `undefined` is "not a team": the caller refuses the whole answer. */
export const toAttributes = (value: unknown): TeamAttributes | undefined => {
  const row = asRow(asRow(value)?.['team_info']);
  if (row === undefined) return undefined;
  const teamId = row['team_id'];
  if (typeof teamId !== 'string') return undefined;
  return {
    accessGroupIds: canonical(stringsOf(row['access_group_ids'])),
    blocked: row['blocked'] === true,
    members: toMemberAttributes(row['members_with_roles']),
    models: canonical(stringsOf(row['models'])),
    objectPermission: toPermissionAttributes(row['object_permission']),
    teamAlias: typeof row['team_alias'] === 'string' ? row['team_alias'] : '',
    teamId,
  };
};

/** The team's own fields (never the roster) where live and declared disagree, by wire name. */
export const teamFieldsDiffering = (live: TeamAttributes, props: TeamProps): readonly string[] => {
  const fields: string[] = [];
  if (live.teamAlias !== props.teamAlias) fields.push('team_alias');
  if (props.models !== undefined && !sameSet(live.models, props.models)) fields.push('models');
  if (props.blocked !== undefined && live.blocked !== props.blocked) fields.push('blocked');
  if (props.accessGroupIds !== undefined && !sameSet(live.accessGroupIds, props.accessGroupIds)) {
    fields.push('access_group_ids');
  }
  for (const wire of permissionDiffers(live.objectPermission, props.objectPermission)) {
    fields.push(`object_permission.${wire}`);
  }
  return fields;
};

/** Everything that differs, the roster included. Empty means converged. */
export const differing = (live: TeamAttributes, props: TeamProps): readonly string[] => [
  ...teamFieldsDiffering(live, props),
  ...(rosterPending(live.members, props.members) ? ['members'] : []),
];

/** Create body: every declared team field. The roster is added afterwards, through `member_add`. */
export const createBody = (props: TeamProps, teamId: string): team.PostNewTeamTeamNewRequest => ({
  team_alias: props.teamAlias,
  team_id: teamId,
  ...(props.models === undefined ? {} : { models: [...props.models] }),
  ...(props.blocked === undefined ? {} : { blocked: props.blocked }),
  ...(props.accessGroupIds === undefined ? {} : { access_group_ids: [...props.accessGroupIds] }),
  ...(props.objectPermission === undefined
    ? {}
    : { object_permission: permissionBody(props.objectPermission) }),
});

/** Update body: the team id and only the fields that differ. `undefined` when nothing but the roster does. */
export const updateBody = (
  props: TeamProps,
  live: TeamAttributes,
): team.UpdateTeamTeamUpdatePostRequest | undefined => {
  const changed = new Set(teamFieldsDiffering(live, props));
  if (changed.size === 0) return undefined;
  const permission = new Set(
    [...changed]
      .filter((field) => field.startsWith('object_permission.'))
      .map((field) => field.slice(18)),
  );
  return {
    team_id: live.teamId,
    ...(changed.has('team_alias') ? { team_alias: props.teamAlias } : {}),
    ...(changed.has('models') ? { models: [...(props.models ?? [])] } : {}),
    ...(changed.has('blocked') ? { blocked: props.blocked ?? false } : {}),
    ...(changed.has('access_group_ids')
      ? { access_group_ids: [...(props.accessGroupIds ?? [])] }
      : {}),
    ...(props.objectPermission !== undefined && permission.size > 0
      ? { object_permission: permissionBody(props.objectPermission, permission) }
      : {}),
  };
};
