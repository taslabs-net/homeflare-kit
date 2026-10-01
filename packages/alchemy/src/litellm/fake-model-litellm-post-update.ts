/**
 * POST /model/update handler for the fake LiteLLM proxy.
 *
 * Extracted from `fake-model-litellm.ts` so each file stays under the repository line cap.
 * See that file for context on what the fake is and what is measured vs. assumed.
 */
import type { Row } from './fake-model-litellm.ts';

type PostUpdateOptions = Readonly<{
  /** `POST /model/update` drops a `false` and an empty list, like a truthiness check would. */
  readonly editIgnoresFalsy?: boolean;
  /**
   * `POST /model/update` parses `litellm_params` the way v1.103.0 `updateLiteLLMParams` does:
   * every unset field is filled with its pydantic default before the write. `None` keeps the
   * stored value; a non-`None` default (`false` on the five flags below) overwrites it.
   */
  readonly fillsParamDefaults?: boolean;
}>;

/**
 * The five `litellm_params` fields whose pydantic default is `False`, not `None`
 * (`litellm/types/router.py` at v1.103.0). `updateLiteLLMParams` fills every unset field with
 * that default before `update_model` walks the parsed model, so an omitted key is written
 * `false` and a stored `true` is clobbered. A JSON `null` is the `None` that keeps the stored
 * value. A key the parsed model does not declare survives PATCH but is DELETED by POST's
 * column rebuild (`extra_headers`, `weight`, `order` have no field).
 */
const NON_NONE_PARAM_DEFAULTS = [
  'use_in_pass_through',
  'use_litellm_proxy',
  'use_xai_oauth',
  'allow_client_keepalive_override',
  'merge_reasoning_content_in_choices',
] as const;

const fillParamDefaults = (sent: Row): Row => {
  const filled: Row = { ...sent };
  for (const key of NON_NONE_PARAM_DEFAULTS) {
    if (!(key in filled)) filled[key] = false;
  }
  return filled;
};

export interface PostModelUpdateResult {
  readonly response: Response;
  /** Merged row to write back into the table. */
  readonly merged: Row;
  /** Index into the original rows array that `merged` should replace. */
  readonly at: number;
}

/**
 * Handle `POST /model/update`.
 *
 * ⛔ v1.103.0 `update_model` REBUILDS `litellm_params`: it parses the request model
 *   (every unset field filled with its pydantic default, `None` keeps the stored value)
 *   and REPLACES the column, so a stored key the model does not declare is DELETED.
 *   `editIgnoresFalsy` models a proxy that REFUSES a `false` or an empty list: the edit
 *   never lands, so the row's current value survives. Drop the incoming falsy value
 *   BEFORE the rebuild — filtering after erases the field and hides the dropped edit.
 */
export const handlePostModelUpdate = (args: {
  readonly body: Row;
  readonly rows: readonly Row[];
  readonly rowId: (row: Row) => string;
  readonly json: (status: number, body: unknown) => Response;
  readonly options: PostUpdateOptions;
}): PostModelUpdateResult => {
  const { body, rows, rowId, json, options } = args;
  const id = String(((body['model_info'] ?? {}) as Row)['id']);
  const at = rows.findIndex((row) => rowId(row) === id);
  if (at === -1) {
    return { at: -1, merged: {}, response: json(400, { detail: { error: 'model not found' } }) };
  }
  const dropFalsy = <T extends Row>(incoming: T): T =>
    options.editIgnoresFalsy === true
      ? (Object.fromEntries(
          Object.entries(incoming).filter(
            ([, value]) => value !== false && !(Array.isArray(value) && value.length === 0),
          ),
        ) as T)
      : incoming;
  const current = rows[at] as Row;
  const sent = dropFalsy((body['litellm_params'] ?? {}) as Row);
  const stored = { ...(current['litellm_params'] as Row) };
  const parsed = options.fillsParamDefaults === true ? fillParamDefaults(sent) : sent;
  // `None` keeps the stored value; every other field is the parsed model's — nothing else
  // of the stored row survives the rebuild (undeclared keys are dropped).
  const rewritten = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, value === null ? stored[key] : value]),
  );
  const merged: Row = {
    ...current,
    ...(body['model_name'] === undefined ? {} : { model_name: body['model_name'] }),
    ...(body['litellm_params'] === undefined ? {} : { litellm_params: rewritten }),
  };
  return { at, merged, response: json(200, {}) };
};
