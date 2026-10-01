/**
 * The five LiteLLM `/model/*` calls `LiteLLM.Model` uses, through the SDK's typed operations in
 * `@distilled.cloud/litellm/model_management` (LiteLLM 1.103.0; names verified in the generated
 * source, never guessed):
 *
 *   list    `getModelInfoV1ModelInfo`            GET   /model/info
 *   read    `getModelInfoV1ModelInfo`            GET   /model/info?litellm_model_id={id}
 *   create  `addNewModelModelNewPost`            POST  /model/new
 *   patch   `patchModelModelModelIdUpdatePatch`  PATCH /model/{model_id}/update
 *   delete  `deleteModelModelDeletePost`         POST  /model/delete
 *
 * The SDK is generated from LiteLLM OpenAPI **1.103.0** (`model_management.ts`'s header). At that
 * tag, and at v1.100.0, `model_info_v1` raises HTTP 400 when the router has no such deployment
 * (`proxy_server.py`, "Model id = … not found on litellm proxy"), not 404. The same 400 is also
 * "no rights" or a bad filter. The PATCH route's `update_db_model` MERGES: `litellm_params`,
 * `model_name` and `model_info` (`access_groups`, `mode`, `base_model`) all land without
 * rebuilding the column, which is the one write `LiteLLM.Model` converges with (model-form.ts).
 * POST `/model/update` REBUILDS `litellm_params` and deletes stored keys the request model does
 * not declare, so this resource never sends it.
 *
 * ⛔ LIST-FIRST READS. One GET of the whole list answers a group, an id and absence unambiguously,
 *   the way `budget-operations.ts` reads. The by-id read is the same route with the
 *   `litellm_model_id` filter, used only where the list cannot decide (a write-back on a row the
 *   list may not show yet).
 * ⛔ NO MESSAGE SNIFFING (S21). The by-id read's 400 is undeclared on the generated operation, so
 *   it decodes at run time as the shared `BadRequest` class (`HTTP_STATUS_MAP`) and is matched
 *   with `instanceof`, never by the error's text. A 400 is absence only when a re-list also lacks
 *   the id — the rule `deleteModel` already uses. A 404, if a proxy ever answers one, is the same
 *   absence. Any other failure propagates.
 * ⛔ THE ROW'S PARAMS ARE NEVER READ INTO STATE: `toAttributes` (model-form.ts) copies `model`
 *   only when `litellm_params` is an object, and never `api_base` or `api_key` — the v1.103.0
 *   read answers params DECRYPTED but STRIPS `api_key` (measured). What was declared is
 *   remembered as a digest instead.
 * ⚠️ Unlike pass-through endpoints, each deployment is its own DB row: no semaphore.
 */
import * as models from '@distilled.cloud/litellm/model_management';
import { BadRequest, NotFound } from '@distilled.cloud/litellm/Errors';
import * as Effect from 'effect/Effect';
import { type LitellmOpContext, throughFetch } from './operations.ts';
import { toAttributes } from './model-form.ts';
import type { ModelAttributes } from './model-types.ts';
import { LitellmModelUnreadableError } from './model-errors.ts';

const hasRowId = (row: unknown): boolean => {
  if (typeof row !== 'object' || row === null) return false;
  const record = row as Record<string, unknown>;
  const info =
    typeof record['model_info'] === 'object' && record['model_info'] !== null
      ? (record['model_info'] as Record<string, unknown>)
      : {};
  return typeof record['id'] === 'string' || typeof info['id'] === 'string';
};

/**
 * The rows the answer carries. ⚠️ MEASURED with the fake: the SDK types
 * `GetModelInfoV1ModelInfoResponse` as `{ body: unknown }` but hands the decoded JSON back
 * directly (a bare array, or the proxy's `{ data: [...] }` wrapper), so accept all three shapes
 * and refuse anything else — the same rule budget-operations.ts / mcp-server-operations.ts keep.
 */
const rowsOf = (
  response: unknown,
): Effect.Effect<readonly ModelAttributes[], LitellmModelUnreadableError> => {
  const rows: unknown = Array.isArray(response)
    ? response
    : Array.isArray((response as { data?: unknown } | null)?.data)
      ? (response as { data: unknown[] }).data
      : (response as { body?: unknown } | null)?.body;
  return Array.isArray(rows) && rows.every(hasRowId)
    ? Effect.succeed((rows as Record<string, unknown>[]).map(toAttributes))
    : Effect.fail(
        new LitellmModelUnreadableError({
          reason: Array.isArray(rows) ? 'a row has no model id' : 'not a list of deployments',
        }),
      );
};

/** Every deployment row, config-file ones included. This is the read that locates and diffs. */
export const listModels = (): Effect.Effect<
  readonly ModelAttributes[],
  models.GetModelInfoV1ModelInfoError | LitellmModelUnreadableError,
  LitellmOpContext
> => throughFetch(models.getModelInfoV1ModelInfo({})).pipe(Effect.flatMap(rowsOf));

/**
 * One row by id, or `undefined` when the proxy has no such deployment.
 *
 * ⛔ A 400 IS NOT ABSENCE BY ITSELF. v1.103.0 `model_info_v1` raises 400 for a missing id, and the
 *   same status is "no rights" or a bad filter. Re-list, and treat the id as absent only when the
 *   list does not contain it (`deleteModel`'s rule). A 401, a 500 or a dead network says nothing
 *   about whether the row exists and must never be read as absence. The id is re-checked on a
 *   successful answer: a proxy that ignored the filter must not hand back some other row.
 */
export const readModelRow = (modelId: string) =>
  throughFetch(models.getModelInfoV1ModelInfo({ litellm_model_id: modelId })).pipe(
    Effect.catch((error) =>
      error instanceof NotFound
        ? Effect.succeed(undefined)
        : error instanceof BadRequest
          ? listModels().pipe(
              Effect.flatMap((rows) =>
                rows.some((row) => row.id === modelId)
                  ? Effect.fail(error)
                  : Effect.succeed(undefined),
              ),
            )
          : Effect.fail(error),
    ),
    Effect.flatMap((response) =>
      response === undefined
        ? Effect.succeed(undefined)
        : rowsOf(response).pipe(Effect.map((rows) => rows.find((row) => row.id === modelId))),
    ),
  );

/** POST /model/new. The answer carries no usable row (the fake answers `{}`), so the id asked for is the one tracked. */
export const createModel = (body: models.AddNewModelModelNewPostRequest) =>
  throughFetch(models.addNewModelModelNewPost(body)).pipe(Effect.asVoid);

/**
 * PATCH `/model/{model_id}/update`. The ONE write a converge of an existing row fires: its merge
 * carries `litellm_params`, `model_name` and `model_info` together (model-form.ts).
 */
export const patchModel = (body: Record<string, unknown>) =>
  throughFetch(
    models.patchModelModelModelIdUpdatePatch(
      body as unknown as models.PatchModelModelModelIdUpdatePatchRequest,
    ),
  ).pipe(Effect.asVoid);

/**
 * Idempotent BY THIS FUNCTION, not by the vendor. A `BadRequest` re-lists and is swallowed only
 * when the id is genuinely absent — the same delete can also be refused for lack of rights or a
 * disconnected DB, which leaves the row live and must never be reported as done
 * (budget-operations.ts's rule; never the message text, S21).
 */
export const deleteModel = (modelId: string) =>
  throughFetch(models.deleteModelModelDeletePost({ id: modelId })).pipe(
    Effect.asVoid,
    Effect.catchTag('BadRequest', (original) =>
      listModels().pipe(
        Effect.flatMap((rows) =>
          rows.some((row) => row.id === modelId) ? Effect.fail(original) : Effect.void,
        ),
      ),
    ),
  );
