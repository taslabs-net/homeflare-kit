/**
 * The four LiteLLM `/v1/mcp/server*` calls `LiteLLM.MCPServer` uses, through the SDK's typed
 * operations in `@distilled.cloud/litellm/mcp_management` (LiteLLM 1.103.0):
 *
 *   list    `fetchAllMcpServersV1McpServerGet`          GET    /v1/mcp/server
 *   create  `addMcpServerV1McpServerPost`               POST   /v1/mcp/server
 *   update  `editMcpServerV1McpServerPut`               PUT    /v1/mcp/server
 *   delete  `removeMcpServerV1McpServerServerIdDelete`  DELETE /v1/mcp/server/{server_id}
 *
 * ★ READS GO THROUGH THE LIST, not `GET /v1/mcp/server/{id}` (`fetchMcpServerV1McpServerServerIdGet`).
 *   What the by-id route answers for an id that is not there is unmeasured, and this SDK declares no
 *   error for it; a list answers absence unambiguously, and adopt-by-name needs the list anyway.
 * ⛔ NO STATUS SNIFFING. `mcp_management` declares only `UnprocessableEntity` beyond the shared
 *   errors — the distilled `patches/` that type `BadRequest`/`NotFound` cover five other admin tags
 *   (budget, key, team, internal_user, model), not this one. A 400 or 404 from these routes
 *   therefore decodes at run time but is invisible to the type checker, so nothing here matches a
 *   tag or a message. A REAL READ decides instead (`deleteMcpServer`), the way `budget-operations.ts`
 *   and pass-through `operations.ts` do.
 * ⚠️ Unlike pass-through endpoints, each server is its own DB row: no semaphore.
 */
import * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { LitellmMcpServerUnreadableError } from './mcp-server-errors.ts';

const hasServerId = (row: unknown): boolean =>
  typeof row === 'object' &&
  row !== null &&
  typeof (row as { server_id?: unknown }).server_id === 'string';

export const listMcpServers = (): Effect.Effect<
  readonly mcp.LiteLLMMCPServerTable[],
  mcp.FetchAllMcpServersV1McpServerGetError | LitellmMcpServerUnreadableError,
  LitellmOpContext
> =>
  throughFetch(mcp.fetchAllMcpServersV1McpServerGet({})).pipe(
    // ⚠️ The SDK types the answer `{ body: LiteLLMMCPServerTable[] }`, but a top-level JSON array is
    //   handed back as the array itself (measured through the fake, as for `/budget/list`). Accept
    //   both shapes and refuse anything else.
    Effect.flatMap((response) => {
      const rows: unknown = Array.isArray(response)
        ? response
        : (response as { body?: unknown }).body;
      return Array.isArray(rows) && rows.every(hasServerId)
        ? Effect.succeed(rows as readonly mcp.LiteLLMMCPServerTable[])
        : Effect.fail(
            new LitellmMcpServerUnreadableError({
              reason: Array.isArray(rows) ? 'a row has no server_id' : 'not an array',
            }),
          );
    }),
  );

/** Answers the created row, which carries the `server_id` LiteLLM actually used. */
export const createMcpServer = (body: mcp.AddMcpServerV1McpServerPostRequest) =>
  throughFetch(mcp.addMcpServerV1McpServerPost(body));

export const updateMcpServer = (body: mcp.EditMcpServerV1McpServerPutRequest) =>
  throughFetch(mcp.editMcpServerV1McpServerPut(body)).pipe(Effect.asVoid);

const isListed = (rows: readonly mcp.LiteLLMMCPServerTable[], serverId: string): boolean =>
  rows.some((row) => row.server_id === serverId);

/**
 * Idempotent BY THIS FUNCTION, not by the vendor, and with no call at all when the row is already
 * gone. If the delete fails it re-lists: the failure is swallowed only when the id is genuinely
 * absent afterwards (a concurrent removal), otherwise the ORIGINAL error is re-raised — so a delete
 * refused for lack of rights, which leaves the row live, is never reported as done.
 */
export const deleteMcpServer = (serverId: string) =>
  listMcpServers().pipe(
    Effect.flatMap((rows) =>
      !isListed(rows, serverId)
        ? Effect.void
        : throughFetch(mcp.removeMcpServerV1McpServerServerIdDelete({ server_id: serverId })).pipe(
            Effect.asVoid,
            Effect.catch((original) =>
              listMcpServers().pipe(
                Effect.flatMap((after) =>
                  isListed(after, serverId) ? Effect.fail(original) : Effect.void,
                ),
              ),
            ),
          ),
    ),
  );
