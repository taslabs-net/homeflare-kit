/**
 * A fake of LiteLLM's `/model/*` routes for tests — TEST ONLY, never imported by `index.ts`.
 * Like `fake-mcp-litellm.ts` it is a `fetch` function handed to Effect's real `FetchHttpClient`
 * through its `Fetch` reference, so a test exercises distilled's REAL path assembly, JSON encoding
 * and status-to-error matching; only the wire responses a scenario needs are written here.
 *
 * ★ A SEPARATE FILE FROM `fake-litellm.ts` ON PURPOSE: that fake carries the pass-through and
 *   budget routes and is at its size budget; a fake per route family keeps each one small.
 * ⚠️ SHAPES ARE FROM THE GENERATED 1.103.0 SCHEMA (`model_management.ts`), NOT A LIVE READ. What
 *   the real proxy answers on a duplicate create, an update of a missing id, and a delete of a
 *   missing id is UNMEASURED; the fake's 400s are its own choices, and every test that leans on
 *   one says so.
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
  /** `POST /model/update` drops a `false` and an empty list, like a truthiness check would. */
  readonly editIgnoresFalsy?: boolean;
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
      // ★ the same 404 the real proxy answers for a missing id: the SDK decodes it to NotFound
      return found === undefined
        ? json(404, { detail: { error: `ModelInfo with model_id: ${wanted} does not exist` } })
        : json(200, { data: [readable(found)] });
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
      // ⛔ PARTIAL UPDATE, LiteLLM's `update_model` at 1.103.0: only the keys PRESENT are
      //   assigned (`exclude_unset` semantics, model-form.ts) — an omitted `api_base`, `api_key`
      //   or `model_name` is a deliberate leave-alone, never a wipe. `editIgnoresFalsy` models a
      //   proxy that REFUSES a `false` or an empty list: the edit never lands, so the row's
      //   current value survives (model-form.ts merges the incoming entries first, so the
      //   incoming falsy value must be dropped BEFORE the merge, not filtered out after —
      //   filtering after the merge erases the field and hides the dropped edit from the read-back).
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
      const info = dropFalsy((body['model_info'] ?? {}) as Row);
      const merged: Row = {
        ...current,
        ...(body['model_name'] === undefined ? {} : { model_name: body['model_name'] }),
        ...(body['litellm_params'] === undefined
          ? {}
          : { litellm_params: { ...(current['litellm_params'] as Row), ...params } }),
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
