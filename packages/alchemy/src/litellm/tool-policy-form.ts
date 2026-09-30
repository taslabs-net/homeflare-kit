/**
 * Wire bodies, comparison and refusals for `LiteLLM.ToolPolicy`, testable without a server.
 *
 * ★ THE WRITE IS AN UPSERT. `update_tool_policy` (`db/tool_registry_writer.py`, 1.103.0) upserts on
 *   `tool_name`: it CREATES the row when the tool has not been seen (a sent field, else `untrusted`),
 *   and on an existing row updates only the fields that are sent. So there is no separate create.
 */
import type * as tools from '@distilled.cloud/litellm/tools';
import { asRow, isBlank } from './registry-support.ts';
import {
  INPUT_POLICIES,
  OUTPUT_POLICIES,
  type ToolPolicyAttributes,
  type ToolPolicyProps,
} from './tool-policy-types.ts';

/** Names the route table hands to another route before `GET /v1/tool/{tool_name:path}` sees them. */
const shadowed = (name: string): boolean =>
  name === 'list' ||
  name === 'spend' ||
  name === 'policy/options' ||
  ['/detail', '/logs'].some((suffix) => name.endsWith(suffix));

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: ToolPolicyProps): string | undefined => {
  if (isBlank(props.toolName) || props.toolName !== props.toolName.trim()) {
    return '`toolName` must be a non-blank name with no leading or trailing space';
  }
  if (shadowed(props.toolName)) {
    return '`toolName` is one the /v1/tool route table answers itself (list, spend, policy/options, …/detail, …/logs), so it could never be read back';
  }
  if (props.inputPolicy === undefined && props.outputPolicy === undefined) {
    return 'declare `inputPolicy`, `outputPolicy` or both (LiteLLM answers 400 to neither)';
  }
  if (props.inputPolicy !== undefined && !INPUT_POLICIES.includes(props.inputPolicy)) {
    return `\`inputPolicy\` must be one of ${INPUT_POLICIES.join(', ')}`;
  }
  if (props.outputPolicy !== undefined && !OUTPUT_POLICIES.includes(props.outputPolicy)) {
    return `\`outputPolicy\` must be one of ${OUTPUT_POLICIES.join(', ')}`;
  }
  return undefined;
};

/** One tool row. `undefined` is "not a tool row". A missing policy reads as LiteLLM's default. */
export const toAttributes = (value: unknown): ToolPolicyAttributes | undefined => {
  const row = asRow(value);
  if (row === undefined) return undefined;
  const toolId = row['tool_id'];
  const toolName = row['tool_name'];
  if (typeof toolId !== 'string' || typeof toolName !== 'string') return undefined;
  const policy = (field: string): string =>
    typeof row[field] === 'string' && row[field] !== '' ? row[field] : 'untrusted';
  return {
    inputPolicy: policy('input_policy'),
    outputPolicy: policy('output_policy'),
    toolId,
    toolName,
  };
};

/** Wire names of the DECLARED fields where live and declared disagree. */
export const differing = (
  live: ToolPolicyAttributes,
  props: ToolPolicyProps,
): readonly string[] => {
  const fields: string[] = [];
  if (props.inputPolicy !== undefined && live.inputPolicy !== props.inputPolicy) {
    fields.push('input_policy');
  }
  if (props.outputPolicy !== undefined && live.outputPolicy !== props.outputPolicy) {
    fields.push('output_policy');
  }
  return fields;
};

/**
 * The write: the declared fields that differ (all declared ones when the tool row is new). ⚠️ NEVER a
 * `team_id` or `key_hash` — those turn the call into an override of another object's `blocked_tools`.
 */
export const updateBody = (
  props: ToolPolicyProps,
  live: ToolPolicyAttributes | undefined,
): tools.UpdateToolPolicyV1ToolPolicyPostRequest => {
  const changed = live === undefined ? undefined : new Set(differing(live, props));
  return {
    tool_name: props.toolName,
    ...(props.inputPolicy !== undefined && (changed === undefined || changed.has('input_policy'))
      ? { input_policy: props.inputPolicy }
      : {}),
    ...(props.outputPolicy !== undefined && (changed === undefined || changed.has('output_policy'))
      ? { output_policy: props.outputPolicy }
      : {}),
  };
};
