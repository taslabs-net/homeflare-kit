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
 *   v1.103.0. POST `/model/update` writes params and a rename; PATCH writes `model_info`
 *   (`update_db_model`). What the real proxy answers on a duplicate create, an update of a
 *   missing id, and a delete of a missing id is UNMEASURED; the fake's 400s there are its own
 *   choices, and every test that leans on one says so.
 * ★ THE LIST IS THE TABLE, the way `GET /model/info` reads: a row is listed as soon as it is
 *   committed — no in-memory registry like the MCP server list. `listOmits` models the opposite,
 *   rows the list does not answer but the by-id read does, UNMEASURED, to exercise the read-back
 *   fallback (model-operations.ts).
 * ★ `encryptParams` MODELS A PROXY RUNNING WITH A DATABASE MASTER KEY: the read answers the whole
 *   `litellm_params` field as the ciphertext string `"<encrypted>"` (model-form.ts's rule) while
 *   the stored row keeps what was sent, so `models()` still asserts what a resource SENT.
 * ★ `FAKE-*` VALUES ONLY. Nothing here is, or looks like, a real credential.
 */
/** One request that reached the fake. Its own type, so this file depends on no other fake. */
export interface FakeModelRequest {
  readonly method: string;
  readonly path: string;
}

type Row = Record<string, unknown>;

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
  /** The read answers `litellm_params: "<encrypted>"` (a proxy with a database master key). */
  readonly encryptParams?: boolean;
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
   * every unset field is filled with its pydantic default before the merge. `None` keeps the
   * stored value; a non-`None` default (`false` on the five flags below) overwrites it. A key
   * the model does not declare stays on the row — the write is a merge, not a replacement.
   */
  readonly fillsParamDefaults?: boolean;
  /** Ids committed to the table that the list omits; the by-id read still answers them. */
  readonly listOmits?: readonly string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

/**
 * The five `litellm_params` fields whose pydantic default is `False`, not `None`
 * (`litellm/types/router.py` at v1.103.0). `updateLiteLLMParams` fills every unset field with
 * that default before `update_model` walks the parsed model, so an omitted key is written
 * `false` and a stored `true` is clobbered. A JSON `null` is the `None` that keeps the stored
 * value. Keys the model does not declare stay on the stored row.
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

  const readable = (row: Row): Row => ({
    ...row,
    litellm_params: options.encryptParams === true ? '<encrypted>' : row['litellm_params'],
  });

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
      const id = String(((body['model_info'] ?? {}) as Row)['id']);
      const at = rows.findIndex((row) => rowId(row) === id);
      if (at === -1) return json(400, { detail: { error: 'model not found' } });
      // ⛔ v1.103.0 `update_model` writes litellm_params (None keeps the stored value) and
      //   model_name when it changed. It does not apply request model_info. `editIgnoresFalsy`
      //   models a proxy that REFUSES a `false` or an empty list: the edit never lands, so the
      //   row's current value survives. Drop the incoming falsy value BEFORE the merge —
      //   filtering after the merge erases the field and hides the dropped edit.
      const dropFalsy = <T extends Row>(incoming: T): T =>
        options.editIgnoresFalsy === true
          ? (Object.fromEntries(
              Object.entries(incoming).filter(
                ([, value]) => value !== false && !(Array.isArray(value) && value.length === 0),
              ),
            ) as T)
          : incoming;
      const current = rows[at] as Row;
      const params = dropFalsy((body['litellm_params'] ?? {}) as Row);
      const stored = { ...(current['litellm_params'] as Row) };
      // ★ v1.103.0 `update_model` walks the PARSED model, not the keys the client sent.
      //   `None` keeps the stored value and is not written. A default that is not `None` is
      //   written. A key the parsed model does not declare stays: the write is a merge.
      const parsed = options.fillsParamDefaults === true ? fillParamDefaults(params) : params;
      const applied = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value !== null),
      );
      const rewritten: Row = { ...stored, ...applied };
      const merged: Row = {
        ...current,
        ...(body['model_name'] === undefined ? {} : { model_name: body['model_name'] }),
        ...(body['litellm_params'] === undefined ? {} : { litellm_params: rewritten }),
      };
      rows = rows.map((row, i) => (i === at ? merged : row));
      return json(200, {});
    }
    const patch = /^\/model\/([^/]+)\/update$/.exec(url.pathname);
    if (patch !== null && request.method === 'PATCH') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const id = decodeURIComponent(patch[1] ?? '');
      const at = rows.findIndex((row) => rowId(row) === id);
      if (at === -1) return json(400, { detail: { error: 'model not found' } });
      // ★ v1.103.0 `update_db_model`: present model_info keys merge onto the stored row.
      //   An empty access_groups clears the groups. editIgnoresFalsy drops that clear.
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
      const merged: Row = {
        ...current,
        ...(body['model_name'] === undefined ? {} : { model_name: body['model_name'] }),
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
