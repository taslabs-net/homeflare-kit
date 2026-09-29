/**
 * The five LiteLLM `/v1/mcp/server*` calls `LiteLLM.MCPServer` uses, through the SDK's typed
 * operations in `@distilled.cloud/litellm/mcp_management` (LiteLLM 1.103.0):
 *
 *   list    `fetchAllMcpServersV1McpServerGet`          GET    /v1/mcp/server
 *   read    `fetchMcpServerV1McpServerServerIdGet`      GET    /v1/mcp/server/{server_id}
 *   create  `addMcpServerV1McpServerPost`               POST   /v1/mcp/server
 *   update  `editMcpServerV1McpServerPut`               PUT    /v1/mcp/server
 *   delete  `removeMcpServerV1McpServerServerIdDelete`  DELETE /v1/mcp/server/{server_id}
 *
 * ⛔ THE LIST IS NOT THE TABLE. Measured 2026-09-29 by reading the live 1.103.0 container:
 *   `GET /v1/mcp/server` answers `global_mcp_server_manager`'s IN-MEMORY REGISTRY
 *   (`_resolve_accessible_mcp_servers`), not `LiteLLM_MCPServerTable`. `reload_servers_from_database`
 *   loads only rows whose approval status is null, active or approved, and skips a row whose build
 *   throws; the registry is narrowed again by the caller's key (`object_permission.mcp_servers`); and
 *   `add_mcp_server` only LOGS a failed registry refresh after the row is committed. So a row that
 *   is absent from the list can be live in the database. The list is right for adopt-by-name, and
 *   wrong as proof of absence. The database is read by ID (`readMcpServer`): `fetch_mcp_server`
 *   asks `get_mcp_server` (the table) first and answers 404 only when the table, the registry and
 *   a name lookup all miss.
 * ⚠️ THE BY-ID READ HAS SIDE EFFECTS, so it is used only where the list cannot decide: it registers
 *   the row in the registry (`add_server`) and runs a health check against the upstream server.
 * ⛔ NO MESSAGE SNIFFING. `mcp_management` declares only `UnprocessableEntity` beyond the shared
 *   errors — the distilled `patches/` that type `BadRequest`/`NotFound` cover five other admin tags
 *   (budget, key, team, internal_user, model), not this one. A 404 from these routes still decodes
 *   at run time as the SDK's `NotFound` class (core's `HTTP_STATUS_MAP`), invisible to the type
 *   checker; `readMcpServer` tests that class with `instanceof` and nothing else, and a REAL READ
 *   decides (`deleteMcpServer`), the way `budget-operations.ts` and pass-through `operations.ts` do.
 *   The typed fix is a distilled patch for this tag, which belongs in the distilled clone.
 * ⚠️ Unlike pass-through endpoints, each server is its own DB row: no semaphore.
 */
import * as mcp from '@distilled.cloud/litellm/mcp_management';
import { NotFound } from '@distilled.cloud/litellm/Errors';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { LitellmMcpServerUnreadableError } from './mcp-server-errors.ts';

const hasServerId = (row: unknown): boolean =>
  typeof row === 'object' &&
  row !== null &&
  typeof (row as { server_id?: unknown }).server_id === 'string';

/** ⚠️ The REGISTRY as the caller may see it, not the table: see the file header. */
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

/**
 * One row read BY ID, DATABASE FIRST, or `undefined` when the proxy has no such row.
 *
 * ★ THE ROW MUST CARRY THE ID ASKED FOR. When the table has no row, `fetch_mcp_server` falls back to
 *   the registry and then to a lookup by NAME or alias, so an id that happens to be another server's
 *   name answers THAT server. A row with another id is "no such row" here.
 * ⛔ ANY FAILURE OTHER THAN `NotFound` PROPAGATES: a 401, a 500 or a dead network says nothing about
 *   whether the row exists, and must never be read as absence.
 */
export const readMcpServer = (serverId: string) =>
  throughFetch(mcp.fetchMcpServerV1McpServerServerIdGet({ server_id: serverId })).pipe(
    Effect.map((row) => (row.server_id === serverId ? row : undefined)),
    Effect.catch((error) =>
      error instanceof NotFound ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );

/** Answers the created row, which carries the `server_id` LiteLLM actually used. */
export const createMcpServer = (body: mcp.AddMcpServerV1McpServerPostRequest) =>
  throughFetch(mcp.addMcpServerV1McpServerPost(body));

export const updateMcpServer = (body: mcp.EditMcpServerV1McpServerPutRequest) =>
  throughFetch(mcp.editMcpServerV1McpServerPut(body)).pipe(Effect.asVoid);

/**
 * Idempotent BY THIS FUNCTION, not by the vendor. The DELETE is ALWAYS SENT: it acts on the table
 * (`delete_mcp_server` answers 404 for a missing row), so a row the list does not show, because the
 * registry dropped it, is still removed. A list that skipped the call for an unlisted id would drop
 * Alchemy's state for a row that stays live in the database.
 *
 * If the DELETE fails, the failure is swallowed only when a DATABASE-BACKED read by id says the row is
 * absent (`readMcpServer`: a concurrent removal, or a row already gone). A row that is still there,
 * or a read that cannot say, re-raises the ORIGINAL error — so a delete refused for lack of rights,
 * which leaves the row live, is never reported as done.
 */
export const deleteMcpServer = (serverId: string) =>
  throughFetch(mcp.removeMcpServerV1McpServerServerIdDelete({ server_id: serverId })).pipe(
    Effect.asVoid,
    Effect.catch((original) =>
      readMcpServer(serverId).pipe(
        Effect.catch(() => Effect.fail(original)),
        Effect.flatMap((row) => (row === undefined ? Effect.void : Effect.fail(original))),
      ),
    ),
  );
