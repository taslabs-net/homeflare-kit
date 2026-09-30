/**
 * The five LiteLLM `/v1/mcp/toolset*` calls `LiteLLM.Toolset` uses, through the SDK's typed operations
 * in `@distilled.cloud/litellm/mcp_management` (LiteLLM 1.103.0):
 *
 *   list    `fetchMcpToolsetsV1McpToolsetGet`             GET    /v1/mcp/toolset
 *   read    `fetchMcpToolsetV1McpToolsetToolsetIdGet`     GET    /v1/mcp/toolset/{toolset_id}
 *   create  `addMcpToolsetV1McpToolsetPost`               POST   /v1/mcp/toolset          (201)
 *   update  `editMcpToolsetV1McpToolsetPut`               PUT    /v1/mcp/toolset
 *   delete  `removeMcpToolsetV1McpToolsetToolsetIdDelete` DELETE /v1/mcp/toolset/{toolset_id} (202, no body)
 *
 * ⛔ THE LIST CANNOT PROVE ABSENCE, THE BY-ID READ CAN (`mcp_management_endpoints.py` and
 *   `toolset_db.py`, read from the live 1.103.0 container). `list_mcp_toolsets` wraps its query in
 *   `except Exception: … return []`, so a database error answers an EMPTY LIST with a 200; and the
 *   route narrows the answer to the caller's granted toolsets unless the caller is an admin. The by-id
 *   route reads the table (`get_mcp_toolset`, a `find_unique`) and answers 404 only for a missing row.
 *   So the list is used ONLY to adopt by name, and everything else reads by id. A wrong "absent" from
 *   the list can only end in a create, which a unique name turns into a 409 that fails the deploy.
 * ⛔ NO MESSAGE SNIFFING. `readToolset` tests the SDK's `NotFound` CLASS (registry-support.ts) and
 *   nothing else; a 401, a 403 or a dead network propagates, and is never read as absence.
 * ★ DELETE IS IDEMPOTENT BY A REAL READ: a failed DELETE is swallowed only when a by-id read says the
 *   row is gone. A 403 (only PROXY_ADMIN may delete) leaves it live, so it re-raises the original.
 */
import * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { LitellmRegistryUnreadableError } from './registry-errors.ts';
import { bodyOf, isNotFound } from './registry-support.ts';
import { toAttributes } from './toolset-form.ts';
import type { ToolsetAttributes } from './toolset-types.ts';

const RESOURCE = 'LiteLLM.Toolset';

/** ⚠️ NOT PROOF OF ABSENCE: see the file header. Adopt-by-name only. */
export const listToolsets = (): Effect.Effect<
  readonly ToolsetAttributes[],
  mcp.FetchMcpToolsetsV1McpToolsetGetError | LitellmRegistryUnreadableError,
  LitellmOpContext
> =>
  throughFetch(mcp.fetchMcpToolsetsV1McpToolsetGet({})).pipe(
    Effect.flatMap((response) => {
      const rows: unknown = bodyOf(response);
      if (!Array.isArray(rows)) {
        return Effect.fail(
          new LitellmRegistryUnreadableError({ reason: 'not an array', resource: RESOURCE }),
        );
      }
      const parsed = rows.map(toAttributes);
      return parsed.every((row) => row !== undefined)
        ? Effect.succeed(parsed as readonly ToolsetAttributes[])
        : Effect.fail(
            new LitellmRegistryUnreadableError({
              reason: 'a row has no id or name',
              resource: RESOURCE,
            }),
          );
    }),
  );

/**
 * One toolset BY ID, from the table, or `undefined` when the proxy has no such row. The row must carry
 * the id asked for; anything else the proxy answers is "no such row".
 */
export const readToolset = (toolsetId: string) =>
  throughFetch(mcp.fetchMcpToolsetV1McpToolsetToolsetIdGet({ toolset_id: toolsetId })).pipe(
    Effect.map((response) => {
      const row = toAttributes(bodyOf(response));
      return row?.toolsetId === toolsetId ? row : undefined;
    }),
    Effect.catch((error) => (isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error))),
  );

/** The created row, which carries the id LiteLLM issued. `undefined` when the answer is not a toolset. */
export const createToolset = (body: mcp.AddMcpToolsetV1McpToolsetPostRequest) =>
  throughFetch(mcp.addMcpToolsetV1McpToolsetPost(body)).pipe(
    Effect.map((response) => toAttributes(bodyOf(response))),
  );

export const updateToolset = (body: mcp.EditMcpToolsetV1McpToolsetPutRequest) =>
  throughFetch(mcp.editMcpToolsetV1McpToolsetPut(body)).pipe(Effect.asVoid);

export const deleteToolset = (toolsetId: string) =>
  throughFetch(mcp.removeMcpToolsetV1McpToolsetToolsetIdDelete({ toolset_id: toolsetId })).pipe(
    Effect.asVoid,
    Effect.catch((original) =>
      readToolset(toolsetId).pipe(
        Effect.catch(() => Effect.fail(original)),
        Effect.flatMap((row) => (row === undefined ? Effect.void : Effect.fail(original))),
      ),
    ),
  );
