/**
 * A fake of LiteLLM's `/key/*` routes for `LiteLLM.Key` tests — TEST ONLY, never imported by
 * `index.ts`. `fake-litellm.ts` mounts it, so a test still goes through distilled's REAL path
 * assembly, JSON encode/decode and status→typed-error matching over `FetchHttpClient.Fetch`.
 *
 * ★ MEASURED against the litellm 1.103.0 wheel's source (`key_management_endpoints.py`), not a live
 *   proxy: a user-defined `key` must start with `sk-` and be 16+ characters, else 400 (:1477-1490); a
 *   duplicate `key_alias` is 400 on generate and update (`_enforce_unique_key_alias`, :7639-7667);
 *   `/key/update` applies `model_dump(exclude_unset=True)`, so an explicit `null` clears a column
 *   (`duration: null` sets `expires` null, :2468-2500) and omitted fields are untouched; an update
 *   that finds no alias is 404 (`_get_and_validate_existing_key`, per the distilled patch); a delete
 *   of an alias it does not hold is 404 "No keys found" (:4914-4918) and of a key the caller may not
 *   delete 403 (:4933-4936), BOTH answered as a `ProxyException` envelope, because `delete_key_fn`
 *   re-raises through `handle_exception_on_proxy` (`proxy/utils.py:7815`), whose `message` is `str(detail)`
 *   (`_types.py` `ProxyException`): `{"error": {"message": "{'error': 'No keys found'}", "code": "404", ...}}`;
 *   `/key/list` filters `key_alias` exactly unless told otherwise, and
 *   `return_full_object` answers full rows, `token` being the sha256 hex of the key (`hash_token`).
 * ⚠️ NOT MODELLED, or only a stand-in: `disable_custom_api_keys` (a 403 for ANY user-defined key);
 *   a `budget_id` that names no budget is a foreign-key violation whose status is UNMEASURED — 400
 *   here, so a test can prove the Budget is written first.
 * ⛔ THE PLAINTEXT KEY NEVER SITS IN A ROW. Rows carry only `token`, a sha256 of the value, the way
 *   a LiteLLM row carries a hash. The values the proxy was SENT are kept apart in `received()`, so a
 *   test can prove what reached the wire without the value ever being in the state a resource sees.
 */
type Row = Record<string, unknown>;

export interface FakeKeysOptions {
  /** Live rows, wire-shaped like `UserAPIKeyAuth` (`key_alias`, `budget_id`, `models`, `token`, …). */
  readonly keySeed?: readonly Row[];
  /** `GET /key/list` answers this status and nothing else — a transient read failure. */
  readonly keyListStatus?: number;
  /** `POST /key/delete` answers 403 and keeps the row — a caller that may not delete. */
  readonly keyDeleteForbidden?: boolean;
  /** `POST /key/delete` deletes the row and STILL answers 404 — another caller got there first. */
  readonly keyDeleteRaces?: boolean;
  /** `/key/generate` ignores the user-defined `key` and mints its own. */
  readonly keyIgnoresUserValue?: boolean;
  /** `/key/update` drops explicit `null`s instead of writing them (an `exclude_none` merge). */
  readonly keyUpdateIgnoresNull?: boolean;
}

export interface FakeKeys {
  readonly route: (request: Request, url: URL) => Promise<Response>;
  readonly rows: () => readonly Row[];
  /** Every JSON body a `/key/*` write carried, in order. FAKE-* material only. */
  readonly writes: () => readonly { readonly path: string; readonly body: Row }[];
  /** The raw key values `/key/generate` was sent — kept off the rows on purpose. */
  readonly received: () => readonly string[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

/**
 * What `/key/delete` answers a failure with: a `ProxyException`, whose `message` is Python's `str()` of
 * the `HTTPException` detail dict (`{'error': '…'}`), and whose `code` is the status as a string.
 */
const proxyException = (status: number, error: string) =>
  json(status, {
    error: {
      code: String(status),
      message: `{'error': '${error}'}`,
      param: null,
      type: 'internal_server_error',
    },
  });

const sha256 = (value: string): string =>
  new Bun.CryptoHasher('sha256').update(value).digest('hex');

const UNITS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const;

/** `'30d'` → an ISO timestamp that far ahead; `undefined` for anything else (a bad duration is refused; its status is UNMEASURED). */
const expiryFor = (duration: string): string | undefined => {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (match === null) return undefined;
  const unit = UNITS[match[2] as keyof typeof UNITS];
  return new Date(Date.now() + Number(match[1]) * unit).toISOString();
};

/** The columns `/key/update` may write; each list column's `null` means "none". */
const LIST_COLUMNS = new Set(['models', 'allowed_routes']);

export const createFakeKeys = (
  options: FakeKeysOptions | undefined,
  budgetExists: (budgetId: string) => boolean,
): FakeKeys => {
  let rows: Row[] = [...(options?.keySeed ?? [])];
  const writes: { path: string; body: Row }[] = [];
  const received: string[] = [];
  let minted = 0;

  const byAlias = (alias: unknown) => rows.findIndex((row) => row['key_alias'] === alias);

  const generate = (body: Row) => {
    const alias = body['key_alias'];
    const supplied = body['key'];
    if (typeof supplied === 'string') received.push(supplied);
    if (
      typeof supplied === 'string' &&
      (!supplied.startsWith('sk-') || supplied.length < 16) &&
      options?.keyIgnoresUserValue !== true
    ) {
      return json(400, { detail: 'user-defined key must start with sk- and be 16+ characters' });
    }
    if (byAlias(alias) !== -1) return json(400, { detail: `key alias '${String(alias)}' exists` });
    const budgetId = body['budget_id'];
    if (typeof budgetId === 'string' && !budgetExists(budgetId)) {
      return json(400, { detail: `budget ${budgetId} not found` });
    }
    minted += 1;
    const value =
      typeof supplied === 'string' && options?.keyIgnoresUserValue !== true
        ? supplied
        : `sk-FAKE-minted-${minted}-0000000000`;
    const token = sha256(value);
    // ⚠️ A key VALUE already held is a unique-token violation; its status is UNMEASURED.
    if (rows.some((row) => row['token'] === token)) return json(400, { detail: 'key exists' });
    const duration = body['duration'];
    const expires = typeof duration === 'string' ? expiryFor(duration) : null;
    if (expires === undefined) return json(400, { detail: 'invalid duration' });
    const { key: _key, duration: _duration, ...rest } = body;
    const row = { models: [], allowed_routes: [], metadata: {}, ...rest, expires, token };
    rows = [...rows, row];
    return json(200, { ...row, key: value });
  };

  const update = (body: Row) => {
    const at = byAlias(body['key_alias']);
    if (at === -1) return json(404, { detail: 'no key with that alias' });
    const budgetId = body['budget_id'];
    if (typeof budgetId === 'string' && !budgetExists(budgetId)) {
      return json(400, { detail: `budget ${budgetId} not found` });
    }
    const ignoresNull = options?.keyUpdateIgnoresNull === true;
    const patch: Row = {};
    for (const [column, value] of Object.entries(body)) {
      if (column === 'key' || column === 'duration') continue;
      if (value === null && ignoresNull) continue;
      patch[column] = value === null && LIST_COLUMNS.has(column) ? [] : value;
    }
    if ('duration' in body && !(body['duration'] === null && ignoresNull)) {
      const duration = body['duration'];
      const expires = typeof duration === 'string' ? expiryFor(duration) : null;
      if (expires === undefined) return json(400, { detail: 'invalid duration' });
      patch['expires'] = expires;
    }
    rows = rows.map((row, i) => (i === at ? { ...row, ...patch } : row));
    return json(200, {});
  };

  const remove = (body: Row) => {
    if (options?.keyDeleteForbidden === true) {
      return proxyException(403, 'You are not authorized to delete this key');
    }
    const aliases = Array.isArray(body['key_aliases']) ? body['key_aliases'] : [];
    const found = aliases.filter((alias) => byAlias(alias) !== -1);
    if (found.length === 0) return proxyException(404, 'No keys found');
    rows = rows.filter((row) => !found.includes(row['key_alias']));
    if (options?.keyDeleteRaces === true) return proxyException(404, 'No keys found');
    return json(200, { deleted_keys: found });
  };

  const route = async (request: Request, url: URL): Promise<Response> => {
    if (request.method === 'GET' && url.pathname === '/key/list') {
      if (options?.keyListStatus !== undefined) {
        return json(options.keyListStatus, { detail: 'upstream unavailable' });
      }
      const alias = url.searchParams.get('key_alias');
      const matching = rows.filter((row) => alias === null || row['key_alias'] === alias);
      const full = url.searchParams.get('return_full_object') === 'true';
      const keys = full ? matching : matching.map((row) => row['token']);
      return json(200, { keys, total_count: keys.length, current_page: 1, total_pages: 1 });
    }
    if (request.method !== 'POST') return json(405, { detail: `unhandled ${request.method}` });
    const body = (await request.json()) as Row;
    writes.push({ body, path: url.pathname });
    if (url.pathname === '/key/generate') return generate(body);
    if (url.pathname === '/key/update') return update(body);
    if (url.pathname === '/key/delete') return remove(body);
    return json(404, { detail: 'not found' });
  };

  return {
    received: () => [...received],
    route,
    rows: () => [...rows],
    writes: () => [...writes],
  };
};
