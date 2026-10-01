/**
 * A fake of LiteLLM's `/v1/unified_access_group` routes for tests — TEST ONLY. Skeleton and the
 * rules every fake follows: fake-registry-base.ts.
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `access_group_endpoints.py`, read,
 *   not called): the name is UNIQUE (a create or a rename onto a taken name is a 409); a create
 *   answers 201 with the row; the update is partial (`exclude_unset`) and turns a `null` list into
 *   `[]`; a delete answers 204 with NO BODY and a missing id is a 404; writes need PROXY_ADMIN
 *   (`forbidWrites` models the 403). The list is the table.
 * ⚠️ NOT MODELLED: `assigned_team_ids` / `assigned_key_ids` mirroring into teams and keys (the fake
 *   keeps the arrays and does nothing with them), and the display-name expansion of the response.
 *   `dropModel` models `access_group_model_sync.py`: LiteLLM itself removes a model name from a group
 *   when its last deployment goes, which is the drift source the docs warn about.
 */
import { FAKE_KEY, type FakeRecord, empty, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakeAccessGroupLitellm extends FakeRecord {
  /** Every stored group, exactly as the proxy holds it. */
  readonly groups: () => readonly Row[];
  /** LiteLLM's own model-name pruning (`access_group_model_sync.py`). */
  readonly dropModel: (name: string) => void;
}

export interface FakeAccessGroupOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** `POST`/`PUT`/`DELETE` answer 403, as for a key that is not PROXY_ADMIN. */
  readonly forbidWrites?: boolean;
  /** A `PUT` drops empty lists instead of writing them (a truthiness check). */
  readonly editIgnoresEmpty?: boolean;
}

/** A row as `AccessGroupResponse` carries it: every required field present. */
export const groupRow = (fields: Row): Row => ({
  access_agent_ids: [],
  access_agents: [],
  access_mcp_server_ids: [],
  access_mcp_servers: [],
  access_model_names: [],
  assigned_key_ids: [],
  assigned_keys: [],
  assigned_team_ids: [],
  assigned_teams: [],
  created_at: '2026-09-30T00:00:00Z',
  description: null,
  updated_at: '2026-09-30T00:00:00Z',
  ...fields,
});

export const startFakeAccessGroupLitellm = (
  options: FakeAccessGroupOptions = {},
): FakeAccessGroupLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let issued = 0;

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    const byId = /^\/v1\/unified_access_group\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === '/v1/unified_access_group' && request.method === 'GET') {
      return json(200, rows);
    }
    if (request.method !== 'GET' && options.forbidWrites === true) {
      return json(403, { detail: { error: 'not_allowed_access' } });
    }
    if (url.pathname === '/v1/unified_access_group' && request.method === 'POST') {
      if (rows.some((row) => row['access_group_name'] === body['access_group_name'])) {
        return json(409, {
          detail: `Access group '${String(body['access_group_name'])}' already exists`,
        });
      }
      issued += 1;
      const created = groupRow({
        access_group_id: `FAKE-group-${String(issued).padStart(4, '0')}`,
        access_group_name: body['access_group_name'],
        access_mcp_server_ids: body['access_mcp_server_ids'] ?? [],
        access_model_names: body['access_model_names'] ?? [],
        description: body['description'] ?? null,
      });
      rows = [...rows, created];
      return json(201, created);
    }
    if (byId !== null && request.method === 'PUT') {
      const id = decodeURIComponent(byId[1] ?? '');
      const at = rows.findIndex((row) => row['access_group_id'] === id);
      if (at === -1) return json(404, { detail: `Access group '${id}' not found` });
      const taken = rows.some(
        (row, i) =>
          i !== at &&
          body['access_group_name'] !== undefined &&
          row['access_group_name'] === body['access_group_name'],
      );
      if (taken) return json(409, { detail: 'Access group name already exists' });
      const patch = Object.fromEntries(
        Object.entries(body)
          .filter(
            ([, value]) =>
              !(options.editIgnoresEmpty === true && Array.isArray(value) && value.length === 0),
          )
          .map(([key, value]) => [key, value === null && key.startsWith('access_') ? [] : value]),
      );
      rows = rows.map((row, i) => (i === at ? { ...row, ...patch } : row));
      return json(200, rows[at]);
    }
    if (byId !== null && request.method === 'DELETE') {
      const id = decodeURIComponent(byId[1] ?? '');
      if (!rows.some((row) => row['access_group_id'] === id)) {
        return json(404, { detail: `Access group '${id}' not found` });
      }
      rows = rows.filter((row) => row['access_group_id'] !== id);
      return empty(204);
    }
    return json(404, { detail: 'not found' });
  });

  return {
    ...record,
    dropModel: (name) => {
      rows = rows.map((row) => ({
        ...row,
        access_model_names: ((row['access_model_names'] as string[] | undefined) ?? []).filter(
          (each) => each !== name,
        ),
      }));
    },
    groups: () => rows.map((row) => ({ ...row })),
  };
};
