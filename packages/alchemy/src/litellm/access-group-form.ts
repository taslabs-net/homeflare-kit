/**
 * Wire bodies, comparison and refusals for `LiteLLM.AccessGroup`, testable without a server.
 *
 * ★ THE UPDATE IS A PARTIAL ONE, so it sends only what differs. `update_access_group` builds its
 *   write from `data.model_dump(exclude_unset=True)` (`access_group_endpoints.py`, 1.103.0), and turns
 *   a `null` list into `[]`. Nothing here relies on an omitted field being kept beyond that rule.
 * ★ THE ROW READ BACK IS THE WHOLE TABLE, through `GET /v1/unified_access_group`. That route has no
 *   filter and no by-name form, and it answers absence unambiguously, which a by-id `GET` (a 404 the
 *   SDK does not declare for this tag) does not.
 */
import type * as ag from '@distilled.cloud/litellm/access_groups';
import {
  asRow,
  canonical,
  firstBadEntry,
  firstDuplicate,
  isBlank,
  sameSet,
  stringOrNull,
  stringsOf,
} from './registry-support.ts';
import type { AccessGroupAttributes, AccessGroupProps } from './access-group-types.ts';

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: AccessGroupProps): string | undefined => {
  if (isBlank(props.accessGroupName) || props.accessGroupName !== props.accessGroupName.trim()) {
    return '`accessGroupName` must be a non-blank name with no leading or trailing space';
  }
  if (props.description !== undefined && isBlank(props.description)) {
    return '`description` is blank; leave it out to keep the live text';
  }
  for (const [field, values] of [
    ['modelNames', props.modelNames ?? []],
    ['mcpServerIds', props.mcpServerIds ?? []],
  ] as const) {
    const bad = firstBadEntry(values);
    if (bad !== undefined)
      return `\`${field}\` has a blank or padded entry (${JSON.stringify(bad)})`;
    const twice = firstDuplicate(values);
    if (twice !== undefined) return `\`${field}\` lists ${JSON.stringify(twice)} twice`;
  }
  return undefined;
};

/** One row of the list. `undefined` is "not a row": the caller refuses the whole answer. */
export const toAttributes = (value: unknown): AccessGroupAttributes | undefined => {
  const row = asRow(value);
  if (row === undefined) return undefined;
  const accessGroupId = row['access_group_id'];
  const accessGroupName = row['access_group_name'];
  if (typeof accessGroupId !== 'string' || typeof accessGroupName !== 'string') return undefined;
  return {
    accessGroupId,
    accessGroupName,
    description: stringOrNull(row['description']),
    mcpServerIds: canonical(stringsOf(row['access_mcp_server_ids'])),
    modelNames: canonical(stringsOf(row['access_model_names'])),
  };
};

/**
 * Wire names of the fields where live and declared disagree. The description counts only when
 * declared; the two grant lists always count, an undeclared one meaning "grants nothing".
 */
export const differing = (
  live: AccessGroupAttributes,
  props: AccessGroupProps,
): readonly string[] => {
  const fields: string[] = [];
  if (live.accessGroupName !== props.accessGroupName) fields.push('access_group_name');
  if (props.description !== undefined && live.description !== props.description) {
    fields.push('description');
  }
  if (!sameSet(live.modelNames, props.modelNames ?? [])) fields.push('access_model_names');
  if (!sameSet(live.mcpServerIds, props.mcpServerIds ?? [])) fields.push('access_mcp_server_ids');
  return fields;
};

/** Create body: the name and both grant lists always (a create with none would be an empty group). */
export const createBody = (
  props: AccessGroupProps,
): ag.CreateAccessGroupV1UnifiedAccessGroupPostRequest => ({
  access_group_name: props.accessGroupName,
  access_mcp_server_ids: [...(props.mcpServerIds ?? [])],
  access_model_names: [...(props.modelNames ?? [])],
  ...(props.description === undefined ? {} : { description: props.description }),
});

/** Update body: only the fields that differ, so nothing the declaration does not manage is sent. */
export const updateBody = (
  props: AccessGroupProps,
  live: AccessGroupAttributes,
): Omit<ag.UpdateAccessGroupV1UnifiedAccessGroupAccessGroupIdPutRequest, 'access_group_id'> => {
  const changed = new Set(differing(live, props));
  return {
    ...(changed.has('access_group_name') ? { access_group_name: props.accessGroupName } : {}),
    ...(changed.has('description') ? { description: props.description ?? null } : {}),
    ...(changed.has('access_model_names')
      ? { access_model_names: [...(props.modelNames ?? [])] }
      : {}),
    ...(changed.has('access_mcp_server_ids')
      ? { access_mcp_server_ids: [...(props.mcpServerIds ?? [])] }
      : {}),
  };
};
