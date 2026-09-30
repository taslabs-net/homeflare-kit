/**
 * What a `LiteLLM.ToolPolicy` declares (props) and what is remembered about it (attributes).
 *
 * ★ A TOOL POLICY IS THE TRUST SETTING OF ONE TOOL in `LiteLLM_ToolTable` (`/v1/tool/policy`): an
 *   input policy (`untrusted`, `trusted`, `blocked`) and an output policy (`untrusted`, `trusted`).
 *   LiteLLM DISCOVERS tools as requests use them and gives each `untrusted`/`untrusted`
 *   (`TOOL_POLICY_OPTIONS`, `tool_management_endpoints.py`, 1.103.0); this resource sets them.
 * ⛔ IT DOES NOTHING UNTIL THE `tool_policy` GUARDRAIL IS CONFIGURED. The rows are data; only
 *   `guardrails/guardrail_hooks/tool_policy/tool_policy_guardrail.py` reads them, and it is a guardrail
 *   the proxy's own config must enable (`guardrails: - guardrail_name: tool_policy, litellm_params:
 *   { guardrail: tool_policy, mode: post_call }`, its module docstring). Declaring a policy without it
 *   is an inert row, not a control. Measured 2026-09-30: the rendered CT100 config has no
 *   `tool_policy` guardrail (count 0), so on that proxy today these rows are not enforced.
 * ⚠️ NOT MODELLED: the team and key OVERRIDES of `POST /v1/tool/policy` (`team_id`, `key_hash`). An
 *   override is stored as an entry of that team's or key's `object_permission.blocked_tools`
 *   (`add_tool_to_object_permission_blocked`), the same list `LiteLLM.Team` manages through
 *   `objectPermission.blockedTools`; two resources writing one list would fight. Block a tool for a
 *   team there, and for a key on the key.
 */
export type ToolInputPolicy = 'untrusted' | 'trusted' | 'blocked';
export type ToolOutputPolicy = 'untrusted' | 'trusted';

export interface ToolPolicyProps {
  /**
   * The tool's name as LiteLLM records it (for an MCP tool, `<server prefix>-<tool>`). Changing it is
   * a DIFFERENT tool, so it is a replace. Refused if it is one of the names the route table shadows
   * (`list`, `spend`, `policy/options`) or ends in `/detail` or `/logs`: the read is
   * `GET /v1/tool/{tool_name:path}`, which those routes are registered before.
   */
  readonly toolName: string;
  /** Compared and sent only when declared. Declare at least one of the two. */
  readonly inputPolicy?: ToolInputPolicy;
  /** Compared and sent only when declared. Declare at least one of the two. */
  readonly outputPolicy?: ToolOutputPolicy;
}

export interface ToolPolicyAttributes {
  readonly toolName: string;
  readonly toolId: string;
  /** What the row carries, as a string: a later LiteLLM may add a value this package does not know. */
  readonly inputPolicy: string;
  readonly outputPolicy: string;
}

/** What LiteLLM gives a newly discovered tool, and what `delete` resets a managed field to. */
export const DEFAULT_TOOL_POLICY = 'untrusted';
export const INPUT_POLICIES: readonly ToolInputPolicy[] = ['untrusted', 'trusted', 'blocked'];
export const OUTPUT_POLICIES: readonly ToolOutputPolicy[] = ['untrusted', 'trusted'];
