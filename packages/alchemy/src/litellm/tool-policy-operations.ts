/**
 * The two LiteLLM `/v1/tool*` calls `LiteLLM.ToolPolicy` uses, through the SDK's typed operations in
 * `@distilled.cloud/litellm/tools` (LiteLLM 1.103.0):
 *
 *   read   `getToolV1ToolToolNameGet`       GET  /v1/tool/{tool_name:path}
 *   write  `updateToolPolicyV1ToolPolicyPost`  POST /v1/tool/policy   (an UPSERT on tool_name)
 *
 * ⛔ A READ THAT SAYS "NOT FOUND" IS NOT PROOF OF ABSENCE. `db_get_tool` (`db/tool_registry_writer.py`)
 *   wraps its query in `except Exception: log; return None`, and the route turns `None` into a 404, so a
 *   database error reads exactly like a tool that was never seen. Nothing here depends on it: the write
 *   is an upsert, so a wrong "absent" ends in a write that succeeds or fails loudly, and the read back
 *   after it is what the deploy reports.
 * ⛔ THERE IS NO DELETE ROUTE for a tool row or for its global policy: `DELETE /v1/tool/{name}/overrides`
 *   removes only a team or key override. So this resource's delete RESETS the fields it managed to
 *   LiteLLM's default (`untrusted`), it does not remove a row. It is a write, so it runs only when the
 *   stack opts in (`retain` is the default), and only for a field that is not already the default.
 * ⛔ NO MESSAGE SNIFFING: absence is the SDK's `NotFound` CLASS (registry-support.ts) and nothing else.
 */
import * as tools from '@distilled.cloud/litellm/tools';
import * as Effect from 'effect/Effect';
import { throughFetch } from './operations.ts';
import { bodyOf, isNotFound } from './registry-support.ts';
import { toAttributes } from './tool-policy-form.ts';
import { DEFAULT_TOOL_POLICY, type ToolPolicyProps } from './tool-policy-types.ts';

/** One tool by name, or `undefined` when the proxy has no such row (see the file header). */
export const readTool = (toolName: string) =>
  throughFetch(tools.getToolV1ToolToolNameGet({ tool_name: toolName })).pipe(
    Effect.map((response) => {
      const row = toAttributes(bodyOf(response));
      return row?.toolName === toolName ? row : undefined;
    }),
    Effect.catch((error) => (isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error))),
  );

export const writeToolPolicy = (body: tools.UpdateToolPolicyV1ToolPolicyPostRequest) =>
  throughFetch(tools.updateToolPolicyV1ToolPolicyPost(body)).pipe(Effect.asVoid);

/**
 * The delete: reset each managed field that is not already the default, and nothing else. A tool the
 * proxy does not know, or one already at the defaults, sends no request (an empty body would be a 400).
 */
export const resetToolPolicy = (props: ToolPolicyProps) =>
  readTool(props.toolName).pipe(
    Effect.flatMap((live) => {
      if (live === undefined) return Effect.void;
      const inputStale =
        props.inputPolicy !== undefined && live.inputPolicy !== DEFAULT_TOOL_POLICY;
      const outputStale =
        props.outputPolicy !== undefined && live.outputPolicy !== DEFAULT_TOOL_POLICY;
      if (!inputStale && !outputStale) return Effect.void;
      return writeToolPolicy({
        tool_name: props.toolName,
        ...(inputStale ? { input_policy: DEFAULT_TOOL_POLICY } : {}),
        ...(outputStale ? { output_policy: DEFAULT_TOOL_POLICY } : {}),
      });
    }),
  );
