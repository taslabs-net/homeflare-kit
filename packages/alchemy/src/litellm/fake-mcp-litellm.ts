/**
 * A fake of LiteLLM's `/v1/mcp/server` routes for tests — TEST ONLY, never imported by `index.ts`.
 * Like `fake-litellm.ts` it is a `fetch` function handed to Effect's real `FetchHttpClient` through
 * its `Fetch` reference, so a test exercises distilled's REAL path assembly, JSON encoding and
 * status-to-error matching; only the wire responses a scenario needs are written here.
 *
 * ★ A SEPARATE FILE FROM `fake-litellm.ts` ON PURPOSE: that fake carries the pass-through and
 *   budget routes and is at its size budget; a fake per route family keeps each one small.
 * ⚠️ SHAPES ARE FROM THE GENERATED 1.103.0 SCHEMA (`mcp_management.ts`), NOT A LIVE READ. What the
 *   real proxy does on a duplicate create, an edit of a missing id, a delete of a missing id, and
 *   whether its list redacts `credentials` is UNMEASURED; the answers below (400, 404, 404, redacted
 *   unless `echoCredentials`) are the fake's own choices, and every test that leans on one says so.
 * ★ ONE RULE IS MEASURED, NOT CHOSEN: an edit that changes `auth_type` and sends no `credentials` key
 *   clears the stored credential (litellm 1.103.0, `db.py` lines 1013-1014, read from the live
 *   container; every static type is its own credential class). The engine tests that rely on it are
 *   `mcp-server-retype.test.ts`.
 * ★ THREE MORE RULES ARE MEASURED (2026-09-29, the live 1.103.0 container, read from source and, for
 *   the alias rule, by running its own normaliser on a body): (1) `GET /v1/mcp/server` is the
 *   in-memory REGISTRY, not the table, so a row can be committed and not listed (`registryMisses`,
 *   `hideCreated`); the by-id `GET` reads the table first and REGISTERS the row it finds. (2) The
 *   list's `description` is `mcp_info.description` when that key exists, else the column. (3) A
 *   write with a `server_name` and no `alias` defaults the alias to the name and WRITES it; `-` in
 *   either name is a 400, and a space in an alias becomes `_`.
 * ⚠️ `servers()` RETURNS WHAT REACHED THE PROXY, credentials included, so a test can assert what
 *   was SENT. The list route (`GET`) is what a resource can read, and it hides them by default.
 * ★ `FAKE-*` VALUES ONLY. Nothing here is, or looks like, a real credential.
 */
/** One request that reached the fake. Its own type, so this file depends on no other fake. */
export interface FakeMcpRequest {
  readonly method: string;
  readonly path: string;
}

type Row = Record<string, unknown>;

export interface FakeMcpLitellm {
  readonly fetch: typeof globalThis.fetch;
  /** Every stored row exactly as the proxy holds it, `credentials` included. */
  readonly servers: () => readonly Row[];
  readonly requests: () => readonly FakeMcpRequest[];
  /** The JSON bodies of every `POST`/`PUT`, in order. */
  readonly bodies: () => readonly Row[];
}

export interface FakeMcpOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** `GET` echoes the stored `credentials` instead of hiding them (a worst-case proxy). */
  readonly echoCredentials?: boolean;
  /** `PUT` drops an empty list and a `false`, like a truthiness check would. */
  readonly editIgnoresFalsy?: boolean;
  /** `POST` ignores a supplied `server_id` and issues its own. */
  readonly issuesOwnId?: boolean;
  /** Every `DELETE` answers 400, whether or not the row exists (no rights). */
  readonly forbidDelete?: boolean;
  /** Ids committed to the table that the registry does not hold (a failed reload), so the list omits them. */
  readonly registryMisses?: readonly string[];
  /** A `POST` commits the row but its registry refresh fails (LiteLLM only logs it). */
  readonly hideCreated?: boolean;
  /**
   * The by-id `GET` answers 403, whether or not the row exists. ⚠️ Not 500: the SDK retries 5xx with
   * backoff (`Retry.Retry`), which would take a test tens of seconds to no purpose.
   */
  readonly readFails?: boolean;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

const ISSUED_ID = 'FAKE-issued-id-0001';

/** A minimal 1.103.0-shaped row, as the list route returns it. */
export const serverRow = (fields: Row): Row => ({
  allow_all_keys: false,
  allowed_tools: [],
  auth_type: null,
  mcp_access_groups: [],
  transport: 'http',
  ...fields,
});

/** LiteLLM's `normalize_server_name`: spaces become underscores. */
const normalised = (name: unknown): string => String(name).replaceAll(' ', '_');

/** What the list shows as `description`: `mcp_info.description` when the KEY exists, else the column. */
const effectiveDescription = (row: Row): unknown => {
  const info = row['mcp_info'] as Row | null | undefined;
  if (info !== null && info !== undefined && 'description' in info) return info['description'];
  return row['description'] === undefined || row['description'] === '' ? null : row['description'];
};

/**
 * `validate_and_normalize_mcp_server_payload`: the alias LiteLLM will write, or `undefined` for none,
 * or the 400 body. A `server_name` with no alias gives the alias the name.
 */
const aliasFor = (body: Row): { alias?: string; refusal?: string } => {
  for (const field of ['server_name', 'alias']) {
    if (typeof body[field] === 'string' && body[field].includes('-')) {
      return { refusal: `Server name cannot contain '-'. Found: ${body[field]}` };
    }
  }
  if (typeof body['alias'] === 'string' && body['alias'] !== '') {
    return { alias: normalised(body['alias']) };
  }
  return typeof body['server_name'] === 'string' && body['server_name'] !== ''
    ? { alias: normalised(body['server_name']) }
    : {};
};

export const startFakeMcpLitellm = (options: FakeMcpOptions = {}): FakeMcpLitellm => {
  const masterKey = options.masterKey ?? 'sk-test-master';
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  const requests: FakeMcpRequest[] = [];
  const bodies: Row[] = [];
  const misses = new Set(options.registryMisses ?? []);
  /** The ids the in-memory registry holds. */
  const registered = new Set(
    rows.map((row) => String(row['server_id'])).filter((id) => !misses.has(id)),
  );

  const stored = (row: Row): Row =>
    options.echoCredentials === true ? row : { ...row, credentials: null };
  const listed = (row: Row): Row => ({ ...stored(row), description: effectiveDescription(row) });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
    if (request.headers.get('authorization') !== `Bearer ${masterKey}`) {
      return json(401, { detail: 'invalid api key' });
    }
    if (url.pathname === '/v1/mcp/server' && request.method === 'GET') {
      return json(200, rows.filter((row) => registered.has(String(row['server_id']))).map(listed));
    }
    if (url.pathname === '/v1/mcp/server' && request.method === 'POST') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const id = options.issuesOwnId === true ? ISSUED_ID : String(body['server_id']);
      if (rows.some((row) => row['server_id'] === id)) {
        return json(400, { detail: { error: `MCP server ${id} already exists` } });
      }
      const { alias, refusal } = aliasFor(body);
      if (refusal !== undefined) return json(400, { detail: { error: refusal } });
      const created = serverRow({ ...body, alias, server_id: id });
      rows = [...rows, created];
      if (options.hideCreated !== true) registered.add(id);
      return json(200, stored(created));
    }
    if (url.pathname === '/v1/mcp/server' && request.method === 'PUT') {
      const body = (await request.json()) as Row;
      bodies.push(body);
      const at = rows.findIndex((row) => row['server_id'] === body['server_id']);
      if (at === -1) return json(404, { detail: { error: 'MCP server not found' } });
      const { alias, refusal } = aliasFor(body);
      if (refusal !== undefined) return json(400, { detail: { error: refusal } });
      const written: Row = { ...body, ...(alias === undefined ? {} : { alias }) };
      const patch: Row = Object.fromEntries(
        Object.entries(written).filter(([, value]) =>
          options.editIgnoresFalsy === true
            ? value !== false && !(Array.isArray(value) && value.length === 0)
            : true,
        ),
      );
      // ★ measured: a changed auth class with no `credentials` key wipes the stored credential
      if (
        typeof body['auth_type'] === 'string' &&
        body['auth_type'] !== rows[at]?.['auth_type'] &&
        !('credentials' in body)
      ) {
        patch['credentials'] = null;
      }
      rows = rows.map((row, i) => (i === at ? { ...row, ...patch } : row));
      registered.add(String(body['server_id']));
      return json(200, stored(rows[at] ?? {}));
    }
    const byId = /^\/v1\/mcp\/server\/([^/]+)$/.exec(url.pathname);
    if (byId !== null && request.method === 'GET') {
      if (options.readFails === true) return json(403, { detail: 'not_allowed_access' });
      const id = decodeURIComponent(byId[1] ?? '');
      // ★ measured: the table first (and the row is registered), then the registry by id, name or alias
      const found =
        rows.find((row) => row['server_id'] === id) ??
        rows.find(
          (row) =>
            registered.has(String(row['server_id'])) &&
            [row['server_id'], row['server_name'], row['alias']].includes(id),
        );
      if (found === undefined) {
        return json(404, { detail: { error: `MCP Server with id ${id} not found` } });
      }
      registered.add(String(found['server_id']));
      return json(200, stored(found));
    }
    if (byId !== null && request.method === 'DELETE') {
      if (options.forbidDelete === true) return json(400, { detail: 'not_allowed_access' });
      const id = decodeURIComponent(byId[1] ?? '');
      if (!rows.some((row) => row['server_id'] === id)) {
        return json(404, { detail: { error: `MCP server ${id} not found` } });
      }
      rows = rows.filter((row) => row['server_id'] !== id);
      registered.delete(id);
      return json(200, {});
    }
    return json(404, { detail: 'not found' });
  }) as typeof globalThis.fetch;

  return {
    bodies: () => [...bodies],
    fetch,
    requests: () => [...requests],
    servers: () => rows.map((row) => ({ ...row })),
  };
};
