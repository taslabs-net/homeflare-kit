/**
 * Refusals, wire bodies, the read shape and the comparison for `LiteLLM.Model`, testable without
 * a server. Credential handling is model-credential.ts's; the URL rules are mcp-server-url.ts's.
 *
 * ⛔ WHAT IS COMPARED, WITH ENCRYPTION IN MIND. LiteLLM stores `litellm_params` encrypted when the
 *   proxy runs with a database master key (`prisma_client.py`, `encrypt_value`, tag v1.103.0) and
 *   answers a row whose `litellm_params` are ciphertext or whose sensitive fields are omitted —
 *   `/v2/model/info`'s own docstring says api keys and api_base are left out. So:
 *   - `model_name`, `model_info.id`, `mode`, `base_model` and `access_groups` are compared from
 *     the fields the read returns.
 *   - `model`, `api_base` and `api_key` are compared through a DIGEST of the DECLARED values
 *     (`declaredDigest`), carried in attributes as `paramsSeal`, never a digest of the live row.
 *     A plan therefore reports drift when the declaration changes and stays quiet when the proxy
 *     hides a field it was told before — the false-drift answer the encrypted row leaves no other
 *     way to. A field the proxy DOES return (`model`) is additionally compared when the read
 *     carries it; the seal is what decides when the read says nothing.
 * ⛔ A LIVE `api_key` IS NEVER OVERWRITTEN BY AN ADOPTED ROW'S NOTHING. `apiKey` omitted on an
 *   adopted row sends no `api_key` and the live reference is kept; `differing` reports no drift
 *   for it. Declaring `apiKey` is what moves the row onto `os.environ/NAME`.
 * ⛔ EVERYTHING AN EXISTING ROW NEEDS GOES TO ONE PATCH `/model/{model_id}/update`. At the tag
 *   the SDK was generated from (OpenAPI 1.103.0), POST `/model/update`'s `update_model` REBUILDS
 *   `litellm_params` from the parsed request model and REPLACES the column: a key the model does
 *   not declare (`extra_headers`, `weight`, `order`) is DELETED from the stored row, and a
 *   non-`None` pydantic default (`false` on the five flags in `LEAVE_ALONE_PARAMS`) overwrites
 *   it — measured on a throwaway 1.103.0 proxy, and the reason a params POST is never sent. The
 *   PATCH route's `update_db_model` instead MERGES: sent keys land, the rest of the row is
 *   preserved, and a JSON `null` keeps the stored value. So one PATCH carries the managed
 *   `litellm_params` (with `null` for those five flags), the `model_name` when it changed, and
 *   the `model_info` fields — `access_groups`, `mode`, `base_model`, and the row's own `id`, so
 *   an adopt-by-id re-affirms the row it pinned. `model_name` is sent only when it changed,
 *   because a same-name write would collide with another deployment in the group (model.ts).
 */
import type * as models from '@distilled.cloud/litellm/model_management';
import {
  type ModelAttributes,
  type ModelProps,
  hasProviderPrefix,
  isBlank,
} from './model-types.ts';
import { redactUrl, urlProblem } from './mcp-server-url.ts';
import { declaredValues, sealFromValues } from './model-credential.ts';

/** The first reason a declaration is refused, or `undefined`. Pure: no environment, no server. */
export const firstProblem = (props: ModelProps): string | undefined => {
  if (isBlank(props.modelName) || props.modelName !== props.modelName.trim()) {
    return '`modelName` must be a non-empty string without leading or trailing whitespace';
  }
  if (props.id !== undefined && isBlank(props.id)) {
    return '`id` must be a non-empty string when declared';
  }
  if (isBlank(props.model)) return '`model` must be a non-empty string';
  if (!hasProviderPrefix(props.model)) {
    return `\`model\` must carry a provider prefix, e.g. "xai/${props.model}": LiteLLM routes by it`;
  }
  if (
    props.model.toLowerCase().startsWith('openai/') &&
    props.modelName.toLowerCase().startsWith('grok')
  ) {
    return '`model` must not use the "openai/" prefix on a grok group: Grok is xAI, declare "xai/…"';
  }
  if (props.apiBase !== undefined) {
    const url = urlProblem(props.apiBase);
    if (url !== undefined) return url;
  }
  if (
    props.apiKey !== undefined &&
    (typeof props.apiKey !== 'object' || typeof props.apiKey.fromEnv !== 'string')
  ) {
    return "`apiKey` takes `{ fromEnv: 'NAME' }`, never a value: the value would land in Alchemy's unencrypted state";
  }
  if (props.apiKey !== undefined && isBlank(props.apiKey.fromEnv)) {
    return '`apiKey.fromEnv` must name an environment variable';
  }
  return undefined;
};

/** The digest of the DECLARED values, for `paramsSeal`. Pure: no environment, no lookup. */
export const declaredDigest = (props: ModelProps): string => sealFromValues(declaredValues(props));

const sameSet = (live: readonly string[], declared: readonly string[]): boolean =>
  new Set(live).size === new Set(declared).size && declared.every((entry) => live.includes(entry));

/**
 * Wire names of the fields where the live row and the declaration disagree.
 *
 * `model` is compared only when the read carries it (an encrypted row omits it); the seal decides
 * otherwise, and model.ts's diff turns a changed seal into an update. `model_name` mismatch on a
 * pinned id is identity drift — replace in model.ts, update here only when the name changed and
 * the id stayed.
 */
export const differing = (live: ModelAttributes, props: ModelProps): readonly string[] => {
  const out: string[] = [];
  if (live.modelName !== props.modelName) out.push('model_name');
  if (live.model !== null && live.model !== props.model) {
    out.push('model');
  }
  if (props.mode !== undefined && live.mode !== props.mode) out.push('mode');
  if (props.baseModel !== undefined && live.baseModel !== props.baseModel) out.push('base_model');
  if (!sameSet(live.accessGroups, props.accessGroups ?? [])) out.push('access_groups');
  return out;
};

/**
 * One row of `/model/info`, as attributes. ⛔ Copies no `litellm_params` field but `model`, and
 * only when the read returns an OBJECT: the fields a row hides (`api_key` is stripped at
 * v1.103.0) are never mistaken for declared values — `api_base` and any `api_key` are never
 * copied at all. `dbModel` records `model_info.db_model` (false = served from the proxy's config
 * file), defaulting to true when the read omits it. The digest is the caller's (model.ts fills
 * `paramsSeal` from state, a row cannot supply one).
 */
export const toAttributes = (row: Record<string, unknown>): ModelAttributes => {
  const info = (row['model_info'] ?? {}) as Record<string, unknown>;
  const params = row['litellm_params'];
  const carriedModel =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)['model']
      : undefined;
  const id = row['id'] ?? info['id'];
  return {
    accessGroups: Array.isArray(info['access_groups'])
      ? (info['access_groups'] as string[]).map(String)
      : [],
    baseModel: typeof info['base_model'] === 'string' ? info['base_model'] : null,
    dbModel: info['db_model'] === false ? false : true,
    id: String(id),
    mode: typeof info['mode'] === 'string' ? info['mode'] : null,
    model: typeof carriedModel === 'string' ? redactUrl(carriedModel) : null,
    modelName: String(row['model_name'] ?? ''),
    paramsSeal: '',
  };
};

/**
 * `litellm_params` fields whose pydantic default is `False`, not `None` (`litellm/types/router.py`
 * at v1.103.0). A params write parses the request model, which fills every unset field, so an
 * omitted key is written `false`; JSON `null` is the `None` that keeps the stored value. Create
 * does not send them: a new row should take the vendor default.
 */
const LEAVE_ALONE_PARAMS = [
  'allow_client_keepalive_override',
  'merge_reasoning_content_in_choices',
  'use_in_pass_through',
  'use_litellm_proxy',
  'use_xai_oauth',
] as const;

/** The managed `litellm_params` a create sends — with the credential in reference form. */
const managedParams = (props: ModelProps) => {
  const params: Record<string, unknown> = { model: props.model };
  if (props.apiBase !== undefined) params['api_base'] = props.apiBase;
  if (props.apiKey !== undefined) params['api_key'] = `os.environ/${props.apiKey.fromEnv}`;
  return params;
};

/**
 * The same set for a PATCH, plus `null` for every non-`None` default this resource does not own.
 * The PATCH merge keeps the stored value for `None`, so the nulls are what stop a params write
 * clobbering those five flags.
 */
const patchParams = (props: ModelProps): Record<string, unknown> => ({
  ...managedParams(props),
  ...Object.fromEntries(LEAVE_ALONE_PARAMS.map((key) => [key, null])),
});

/**
 * ⚠️ `Record`, then a widening cast in the callers, ON PURPOSE: the generated 1.103.0 request
 *   schema declares neither `access_groups` nor `mode` on `model_info`, while the vendor routes
 *   on both (`model/types.py`'s `access_groups`, the read's own docstring) and the read ANSWERS
 *   both. `modelInfoOf` returns the plain object and the wire probe's runtime encode carries
 *   unknown keys through (measured: the fake receives `model_info.id` and `access_groups` the
 *   typed struct does not declare).
 */
const modelInfoOf = (props: ModelProps): Record<string, unknown> => ({
  ...(props.baseModel === undefined ? {} : { base_model: props.baseModel }),
  ...(props.mode === undefined ? {} : { mode: props.mode }),
  // ★ ALWAYS SENT: `accessGroups` is compared with a default empty set (model-types.ts), so an
  //   omitted list is a declared "no groups" — a partial update must be able to clear them, the
  //   way a budget's soft-only declaration clears max_budget. `mode`/`base_model` are compared
  //   only when declared, so their omission really does leave the live value alone.
  access_groups: [...(props.accessGroups ?? [])],
  id: null,
});

/** A create names the group and pins nothing: the id is in the URL-less POST body's model_info. */
export const createBody = (
  props: ModelProps,
  modelId: string,
): models.AddNewModelModelNewPostRequest => {
  const body: Record<string, unknown> = {
    litellm_params: managedParams(props),
    model_info: { ...modelInfoOf(props), id: modelId },
    model_name: props.modelName,
  };
  return body as unknown as models.AddNewModelModelNewPostRequest;
};

/**
 * PATCH `/model/{model_id}/update`: everything an existing row needs, in the ONE write a
 * converge fires (model.ts). `update_db_model` MERGES (v1.103.0, measured), so:
 *   - `litellm_params` carries the managed keys (with `null` for the five non-`None` defaults
 *     this resource does not own); the merge keeps every stored key the declaration does not
 *     own (`extra_headers`, `weight`, `order`), which is exactly what POST `/model/update`
 *     would DELETE by rebuilding the column.
 *   - `model_info` carries `access_groups` (always present: an omitted list is "no groups" and
 *     must be able to clear), `mode` and `base_model` only when declared, and the row's own
 *     `id`, so an adopt-by-id re-affirms the row it pinned.
 *   - `model_name` only when it changed: a same-name write would collide with a sibling
 *     deployment in the group (model.ts). Not a seal stamp: a matching row records `paramsSeal`
 *     locally (model.ts).
 *
 * ⚠️ `Record`, then a widening cast, for the same reason as {@link modelInfoOf}: the generated
 *   1.103.0 `LitellmTypesRouterModelInfo` declares neither `access_groups` nor `mode`, while the
 *   vendor model allows both (`extra="allow"`) and the read answers both.
 */
export const patchBody = (props: ModelProps, live: ModelAttributes): Record<string, unknown> => {
  const renamed = live.modelName !== props.modelName;
  return {
    model_id: live.id,
    litellm_params: patchParams(props),
    model_info: { ...modelInfoOf(props), id: live.id },
    ...(renamed ? { model_name: props.modelName } : {}),
  };
};
