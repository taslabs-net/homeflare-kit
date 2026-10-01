/**
 * A fake of LiteLLM's `/model/*` routes for tests — TEST ONLY, never imported by `index.ts`.
 * Like `fake-mcp-litellm.ts` it is a `fetch` function handed to Effect's real `FetchHttpClient`
 * through its `Fetch` reference, so a test exercises distilled's REAL path assembly, JSON encoding
 * and status-to-error matching; only the wire responses a scenario needs are written here.
 *
 * ★ A SEPARATE FILE FROM `fake-litellm.ts` ON PURPOSE: that fake carries the pass-through and
 *   budget routes and is at its size budget; a fake per route family keeps each one small.
 * ⚠️ SHAPES ARE FROM THE GENERATED 1.103.0 SCHEMA (`model_management.ts`), NOT A LIVE READ. A
 *   missing id on the by-id read is HTTP 400, measured in `model_info_v1` at v1.100.0 and
 *   v1.103.0. POST `/model/update` REBUILDS `litellm_params` from the parsed request model and
 *   REPLACES the column (deleting stored keys the model does not declare); PATCH merges
 *   (`update_db_model`) after `updateLiteLLMParams` and `exclude_none`. A PATCH of a missing id
 *   is HTTP 404 (`patch_model` at v1.103.0). A duplicate create and a delete of a missing id
 *   stay the fake's own 400s, and every test that leans on one says so.
 * ★ THE LIST IS THE TABLE, the way `GET /model/info` reads: a row is listed as soon as it is
 *   committed — no in-memory registry like the MCP server list. `listOmits` models the opposite,
 *   rows the list does not answer but the by-id read does, UNMEASURED, to exercise the read-back
 *   fallback (model-operations.ts).
 * ★ THE READ ANSWERS THE MEASURED 1.103.0 SHAPE: `litellm_params` DECRYPTED but with `api_key`
 *   STRIPPED (measured on a live proxy; see the comment on `readable`), while the stored row
 *   keeps every key it was sent, so `models()` still asserts what a resource SENT.
 * ★ `FAKE-*` VALUES ONLY. Nothing here is, or looks like, a real credential.
 */
import {
  handlePostModelUpdate,
  withOmittedFalseDefaults,
} from './fake-model-litellm-post-update.ts';

/** One request that reached the fake. Its own type, so this file depends on no other fake. */
export interface FakeModelRequest {
  readonly method: string;
  readonly path: string;
}

export type Row = Record<string, unknown>;

export interface FakeModelLitellm {
  readonly fetch: typeof globalThis.fetch;
  /** Every stored row exactly as the proxy holds it, `litellm_params` included. */
  readonly models: () => readonly Row[];
  readonly requests: () => readonly FakeModelRequest[];
  /** The JSON bodies of every `POST`, in order. */
  readonly bodies: () => readonly Row[];
  /**
   * The next `count` successful `POST /model/new` calls each make the following `GET /model/info`
   * answer 500 once — a read-back that fails after the row is committed.
   */
  readonly failNextReadBacks: (count: number) => void;
}

export interface FakeModelOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** `POST /model/new` ignores the supplied `model_info.id` and issues its own. */
  readonly issuesOwnId?: boolean;
  /** Every `POST /model/delete` answers 400, whether or not the row exists (no rights). */
  readonly forbidDelete?: boolean;
  /**
   * Every by-id `GET /model/info` answers 400 even when the row is listed. Models "no rights" /
   * a bad filter: a 400 is absence only when a re-list also lacks the id (model-operations.ts).
   */
  readonly byIdRefused?: boolean;
  /** `POST /model/update` drops a `false` and an empty list, like a truthiness check would. */
  readonly editIgnoresFalsy?: boolean;
  /**
   * `POST /model/update` and `PATCH /model/{id}/update` parse `litellm_params` the way v1.103.0
   * `updateLiteLLMParams` does: every unset field is filled with its pydantic default before the
   * write. `None` keeps the stored value; a non-`None` default (`false` on the five flags) overwrites
   * it. POST then REPLACES the column. PATCH merges after `exclude_none`, so an explicit JSON `null`
   * is dropped and the stored value survives, while an omitted flag is written `false`.
   */
  readonly fillsParamDefaults?: boolean;
  /** Ids committed to the table that the list omits; the by-id read still answers them. */
  readonly listOmits?: readonly string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

const ISSUED_ID = 'FAKE-issued-id-0001';

/** A minimal 1.103.0-shaped row, as the table holds it: the id lives in `model_info`. */
export const modelRow = (fields: Row): Row => ({
  litellm_params: {},
  model_info: {},
  model_name: '',
  ...fields,
});

/** The id of a stored row, wherever the proxy carried it. */
const rowId = (row: Row): string => {
  const info = (row['model_info'] ?? {}) as Row;
  return String(row['id'] ?? info['id']);
};

export const startFakeModelLitellm = (options: FakeModelOptions = {}): FakeModelLitellm => {
  const masterKey = options.masterKey ?? 'sk-test-master';
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  const requests: FakeModelRequest[] = [];
  const bodies: Row[] = [];
  const omitted = new Set(options.listOmits ?? []);
  let readBacksLeft = 0;
  let failNextGet = false;

  /**
   * The measured 1.103.0 read: `litellm_params` decrypted but with `api_key` stripped — never a
   * ciphertext object, never the credential reference. The stored row keeps everything
   * (`models()`), so what was SENT stays assertable.
   */
  const readable = (row: Row): Row => {
    const { api_key: _stripped, ...params } = row['litellm_params'] as Row;
    return { ...row, litellm_params: params };
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
    if (request.headers.get('authorization') !== `Bearer ${masterKey}`) {
      return json(401, { detail: 'invalid api key' });
    }
    if (url.pathname === '/model/info' && request.method === 'GET') {
      if (failNextGet) {
        failNextGet = false;
        return json(500, { detail: { error: 'injected read-back failure' } });
      }
      const wanted = url.searchParams.get('litellm_model_id');
      const listed = rows.filter((row) => !omitted.has(rowId(row)));
      if (wanted === null) return json(200, { data: listed.map(readable) });
      const found =
        listed.find((row) => rowId(row) === wanted) ?? rows.find((row) => rowId(row) === wanted);
      // ★ v1.100.0 and v1.103.0 `model_info_v1` raise HTTP 400 when the router has no such
      //   deployment (`proxy_server.py`, "Model id = … not found on litellm proxy"), not 404.
      //   The SDK still decodes that undeclared 400 as BadRequest. A 400 is also "no rights".
      if (options.byIdRefused === true || found === undefined) {
        return json(400, {
          detail: { error: `Model id = ${wanted} not found on litellm proxy` },
        });
      }
      return json(200, { data: [readable(found)] });
    }
    if (url.pathname === '/model/new' && request.method === 'POST') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const info = { ...((body['model_info'] ?? {}) as Row) };
      if (options.issuesOwnId === true) info['id'] = ISSUED_ID;
      const id = String(info['id']);
      if (rows.some((row) => rowId(row) === id)) {
        return json(400, { detail: { error: `Model with id ${id} already exists` } });
      }
      rows = [...rows, modelRow({ ...body, model_info: info })];
      if (readBacksLeft > 0) {
        readBacksLeft -= 1;
        failNextGet = true;
      }
      return json(200, {});
    }
    if (url.pathname === '/model/update' && request.method === 'POST') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const update = handlePostModelUpdate({ body, json, options, rowId, rows });
      if (update.at !== -1) {
        rows = rows.map((row, i) => (i === update.at ? update.merged : row));
      }
      return update.response;
    }
    const patch = /^\/model\/([^/]+)\/update$/.exec(url.pathname);
    if (patch !== null && request.method === 'PATCH') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const id = decodeURIComponent(patch[1] ?? '');
      const at = rows.findIndex((row) => rowId(row) === id);
      // ★ v1.103.0 `patch_model` answers 404 when the table has no such id
      //   (`model_management_endpoints.py`, `HTTP_404_NOT_FOUND`), not 400.
      if (at === -1) return json(404, { detail: { error: `Model ${id} not found on proxy.` } });
      // ★ v1.103.0 `update_db_model` MERGES onto the stored row (the opposite of POST's rebuild).
      //   An empty access_groups clears the groups. editIgnoresFalsy drops that clear. The
      //   params parse below is `updateLiteLLMParams` plus `exclude_none` when the flag is on.
      const dropFalsy = <T extends Row>(incoming: T): T =>
        options.editIgnoresFalsy === true
          ? (Object.fromEntries(
              Object.entries(incoming).filter(
                ([, value]) => value !== false && !(Array.isArray(value) && value.length === 0),
              ),
            ) as T)
          : incoming;
      const current = rows[at] as Row;
      const info = dropFalsy((body['model_info'] ?? {}) as Row);
      const sent = dropFalsy((body['litellm_params'] ?? {}) as Row);
      const stored = { ...(current['litellm_params'] as Row) };
      // ★ v1.103.0 parses `litellm_params` as `updateLiteLLMParams` (omitted flags become
      //   `false`) and then `model_dump(exclude_none=True)`. An explicit JSON `null` is `None`
      //   and is dropped, so the stored value survives; an omitted flag is written `false`.
      const parsed = options.fillsParamDefaults === true ? withOmittedFalseDefaults(sent) : sent;
      const applied = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null));
      const params: Row = { ...stored, ...applied };
      const merged: Row = {
        ...current,
        ...(body['model_name'] === undefined ? {} : { model_name: body['model_name'] }),
        ...(body['litellm_params'] === undefined ? {} : { litellm_params: params }),
        ...(body['model_info'] === undefined
          ? {}
          : { model_info: { ...(current['model_info'] as Row), ...info } }),
      };
      rows = rows.map((row, i) => (i === at ? merged : row));
      return json(200, {});
    }
    if (url.pathname === '/model/delete' && request.method === 'POST') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      if (options.forbidDelete === true) return json(400, { detail: 'not_allowed_access' });
      const id = String(body['id']);
      if (!rows.some((row) => rowId(row) === id)) {
        return json(400, { detail: { error: `model with id ${id} not found` } });
      }
      rows = rows.filter((row) => rowId(row) !== id);
      return json(200, {});
    }
    return json(404, { detail: 'not found' });
  }) as typeof globalThis.fetch;

  return {
    bodies: () => [...bodies],
    failNextReadBacks: (count) => {
      readBacksLeft = count;
    },
    fetch,
    models: () => rows.map((row) => ({ ...row })),
    requests: () => [...requests],
  };
};
