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
 *   (`update_db_model`). What the real proxy answers on a duplicate create, an update of a
 *   missing id, and a delete of a missing id is UNMEASURED; the fake's 400s there are its own
 *   choices, and every test that leans on one says so.
 * ★ THE LIST IS THE TABLE, the way `GET /model/info` reads: a row is listed as soon as it is
 *   committed — no in-memory registry like the MCP server list. `listOmits` models the opposite,
 *   rows the list does not answer but the by-id read does, UNMEASURED, to exercise the read-back
 *   fallback (model-operations.ts).
 * ★ THE READ ANSWERS THE MEASURED 1.103.0 SHAPE: `litellm_params` DECRYPTED but with `api_key`
 *   STRIPPED (measured on a live proxy; see the comment on `readable`), while the stored row
 *   keeps every key it was sent, so `models()` still asserts what a resource SENT.
 * ★ `FAKE-*` VALUES ONLY. Nothing here is, or looks like, a real credential.
 */
import { handlePostModelUpdate } from './fake-model-litellm-post-update.ts';

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
   * `POST /model/update` parses `litellm_params` the way v1.103.0 `updateLiteLLMParams` does:
   * every unset field is filled with its pydantic default before the write. `None` keeps the
   * stored value; a non-`None` default (`false` on the five flags below) overwrites it. POST then
   * REPLACES the column — a key the parsed model does not declare is DELETED from the stored row —
   * while PATCH merges: a key the request does not carry survives (both handlers below).
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
      if (at === -1) return json(400, { detail: { error: 'model not found' } });
      // ★ v1.103.0 `update_db_model` MERGES: present `model_info` keys land on the stored row,
      //   present `litellm_params` keys land on the stored params (a JSON `null` keeps the
      //   stored value), and every key the request does not carry is preserved — the opposite
      //   of POST's rebuild (above). An empty access_groups clears the groups.
      //   editIgnoresFalsy drops that clear.
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
      // A JSON `null` is not applied at all, so the stored value survives under it.
      const applied = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== null));
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
    fetch,
    models: () => rows.map((row) => ({ ...row })),
    requests: () => [...requests],
  };
};
