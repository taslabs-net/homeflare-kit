/**
 * A fake of LiteLLM's `/v1/mcp/toolset` routes for tests — TEST ONLY. Skeleton and the rules every
 * fake follows: fake-registry-base.ts.
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `mcp_management_endpoints.py` and
 *   `toolset_db.py`, read, not called): the id is a server-issued uuid (the create has no id field);
 *   the name is unique (create or rename onto a taken one is a 409); a create answers 201 with the
 *   row; the edit is partial — absent keeps, `null` clears, EXCEPT a `null` name or `tools`, which are
 *   no-ops; a delete answers 202 with NO BODY, a missing id is a 404; the by-id read is the table.
 * ★ ALSO MEASURED: the LIST swallows a database error into `[]` (`list_mcp_toolsets`), which
 *   `listSwallowsErrors` models — the list then says nothing about what exists.
 * ⚠️ NOT MODELLED: the caller-scoped narrowing of the list for a non-admin key.
 */
import { FAKE_KEY, type FakeRecord, empty, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakeToolsetLitellm extends FakeRecord {
  readonly toolsets: () => readonly Row[];
}

export interface FakeToolsetOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** `GET /v1/mcp/toolset` answers `[]` whatever exists (a swallowed database error). */
  readonly listSwallowsErrors?: boolean;
  /** `POST`/`PUT`/`DELETE` answer 403, as for a key that is not PROXY_ADMIN. */
  readonly forbidWrites?: boolean;
}

export const toolsetRow = (fields: Row): Row => ({
  created_at: '2026-09-30T00:00:00Z',
  description: null,
  tools: [],
  updated_at: '2026-09-30T00:00:00Z',
  ...fields,
});

export const startFakeToolsetLitellm = (options: FakeToolsetOptions = {}): FakeToolsetLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let issued = 0;

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    const byId = /^\/v1\/mcp\/toolset\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === '/v1/mcp/toolset' && request.method === 'GET') {
      return json(200, options.listSwallowsErrors === true ? [] : rows);
    }
    if (byId !== null && request.method === 'GET') {
      const id = decodeURIComponent(byId[1] ?? '');
      const found = rows.find((row) => row['toolset_id'] === id);
      return found === undefined
        ? json(404, { detail: { error: `Toolset '${id}' not found.` } })
        : json(200, found);
    }
    if (request.method !== 'GET' && options.forbidWrites === true) {
      return json(403, { detail: { error: 'Only proxy admins can change MCP toolsets.' } });
    }
    if (url.pathname === '/v1/mcp/toolset' && request.method === 'POST') {
      if (rows.some((row) => row['toolset_name'] === body['toolset_name'])) {
        return json(409, {
          detail: { error: `A toolset named '${String(body['toolset_name'])}' already exists.` },
        });
      }
      issued += 1;
      const created = toolsetRow({
        description: body['description'] ?? null,
        tools: body['tools'] ?? [],
        toolset_id: `FAKE-toolset-${String(issued).padStart(4, '0')}`,
        toolset_name: body['toolset_name'],
      });
      rows = [...rows, created];
      return json(201, created);
    }
    if (url.pathname === '/v1/mcp/toolset' && request.method === 'PUT') {
      const at = rows.findIndex((row) => row['toolset_id'] === body['toolset_id']);
      if (at === -1) {
        return json(404, {
          detail: { error: `Toolset '${String(body['toolset_id'])}' not found.` },
        });
      }
      const taken = rows.some(
        (row, i) =>
          i !== at &&
          body['toolset_name'] !== undefined &&
          row['toolset_name'] === body['toolset_name'],
      );
      if (taken)
        return json(409, { detail: { error: 'A toolset with that name already exists.' } });
      // ★ measured: absent keeps, null clears — except a null name or tools, which change nothing
      const { toolset_id: _id, ...sent } = body;
      const patch = Object.fromEntries(
        Object.entries(sent).filter(
          ([key, value]) => !(value === null && (key === 'toolset_name' || key === 'tools')),
        ),
      );
      rows = rows.map((row, i) => (i === at ? { ...row, ...patch } : row));
      return json(200, rows[at]);
    }
    if (byId !== null && request.method === 'DELETE') {
      const id = decodeURIComponent(byId[1] ?? '');
      if (!rows.some((row) => row['toolset_id'] === id)) {
        return json(404, { detail: { error: `Toolset '${id}' not found.` } });
      }
      rows = rows.filter((row) => row['toolset_id'] !== id);
      return empty(202);
    }
    return json(404, { detail: 'not found' });
  });

  return { ...record, toolsets: () => rows.map((row) => ({ ...row })) };
};
