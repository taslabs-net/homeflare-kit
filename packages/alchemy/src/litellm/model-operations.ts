/**
 * The five LiteLLM `/model/*` calls `LiteLLM.Model` uses, through the SDK's typed operations in
 * `@distilled.cloud/litellm/model_management` (LiteLLM 1.103.0; names verified in the generated
 * source, never guessed):
 *
 *   list    `getModelInfoV1ModelInfo`       GET   /model/info
 *   read    `getModelInfoV1ModelInfo`       GET   /model/info?litellm_model_id={id}
 *   create  `addNewModelModelNewPost`       POST  /model/new
 *   update  `updateModelModelUpdatePost`    POST  /model/update
 *   delete  `deleteModelModelDeletePost`    POST  /model/delete
 *
 * ⛔ LIST-FIRST READS. One GET of the whole list answers a group, an id and absence unambiguously,
 *   the way `budget-operations.ts` reads. The by-id read is the same route with the
 *   `litellm_model_id` filter, used only where the list cannot decide (a write-back on a row the
 *   list may not show yet).
 * ⛔ NO MESSAGE SNIFFING (S21). The SDK declares `BadRequest`/`UnprocessableEntity` for the writes;
 *   a 404 still decodes at run time as the shared `NotFound` class (`HTTP_STATUS_MAP`), invisible
 *   to the type checker, so the by-id read tests that class with `instanceof` and nothing else.
 *   Absence is decided by a REAL READ, never by an error's text.
 * ⛔ THE ROW'S PARAMS ARE NEVER READ INTO STATE: `toAttributes` (model-form.ts) copies `model` only
 *   when `litellm_params` is an object, and never `api_base` or `api_key` — an encrypted row answers
 *   `"<encrypted>"` for the whole field. What was declared is remembered as a digest instead.
 * ⚠️ Unlike pass-through endpoints, each deployment is its own DB row: no semaphore.
 */
import * as models from '@distilled.cloud/litellm/model_management';
import { NotFound } from '@distilled.cloud/litellm/Errors';
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
 * One row by id, or `undefined` when the proxy has no such deployment. ⛔ ANY FAILURE OTHER THAN
 * `NotFound` PROPAGATES: a 401, a 500 or a dead network says nothing about whether the row exists,
 * and must never be read as absence. The id is re-checked on the answer: a proxy that ignored the
 * filter must not hand back some other row.
 */
export const readModelRow = (modelId: string) =>
  throughFetch(models.getModelInfoV1ModelInfo({ litellm_model_id: modelId })).pipe(
    Effect.catch((error) =>
      error instanceof NotFound ? Effect.succeed(undefined) : Effect.fail(error),
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

export const updateModel = (body: models.UpdateModelModelUpdatePostRequest) =>
  throughFetch(models.updateModelModelUpdatePost(body)).pipe(Effect.asVoid);

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
