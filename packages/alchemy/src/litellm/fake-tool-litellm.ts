/**
 * A fake of LiteLLM's `/v1/tool/{tool_name}` and `/v1/tool/policy` routes for tests — TEST ONLY.
 * Skeleton and the rules every fake follows: fake-registry-base.ts.
 *
 * ★ MEASURED FROM THE LIVE 1.103.0 CONTAINER'S SOURCE (2026-09-30, `tool_management_endpoints.py` and
 *   `db/tool_registry_writer.py`, read, not called): the write is an UPSERT on `tool_name` (a new row
 *   takes a sent field, else `untrusted`; an existing row takes only the fields sent); neither field
 *   sent is a 400; a team or key id turns the write into an override of `blocked_tools`, which this
 *   fake does not model and answers 400 to (nothing here sends one); the read of an unknown tool is a
 *   404; there is NO delete route for a row. `getSwallowsErrors` models `db_get_tool` catching every
 *   exception and answering `None`, which the route turns into a 404 for a tool that exists.
 */
import { FAKE_KEY, type FakeRecord, json, recordingFetch } from './fake-registry-base.ts';
import type { Row } from './registry-support.ts';

export interface FakeToolLitellm extends FakeRecord {
  readonly tools: () => readonly Row[];
}

export interface FakeToolOptions {
  readonly masterKey?: string;
  readonly seed?: readonly Row[];
  /** The by-name `GET` answers 404 whatever exists (a swallowed database error). */
  readonly getSwallowsErrors?: boolean;
  /** `POST /v1/tool/policy` ignores an `output_policy` (a proxy that drops one field). */
  readonly dropsOutputPolicy?: boolean;
}

export const toolRow = (fields: Row): Row => ({
  call_count: 0,
  input_policy: 'untrusted',
  output_policy: 'untrusted',
  ...fields,
});

export const startFakeToolLitellm = (options: FakeToolOptions = {}): FakeToolLitellm => {
  let rows: Row[] = (options.seed ?? []).map((row) => ({ ...row }));
  let issued = 0;

  const record = recordingFetch(options.masterKey ?? FAKE_KEY, ({ body, request, url }) => {
    if (url.pathname === '/v1/tool/policy' && request.method === 'POST') {
      if (body['team_id'] !== undefined || body['key_hash'] !== undefined) {
        return json(400, { detail: 'overrides are not modelled by this fake' });
      }
      if (body['input_policy'] === undefined && body['output_policy'] === undefined) {
        return json(400, {
          detail: 'At least one of input_policy or output_policy must be provided',
        });
      }
      const name = String(body['tool_name']);
      const sent = Object.fromEntries(
        Object.entries({
          input_policy: body['input_policy'],
          output_policy: body['output_policy'],
        }).filter(
          ([key, value]) =>
            value !== undefined && !(options.dropsOutputPolicy === true && key === 'output_policy'),
        ),
      );
      const at = rows.findIndex((row) => row['tool_name'] === name);
      if (at === -1) {
        issued += 1;
        rows = [
          ...rows,
          toolRow({
            tool_id: `FAKE-tool-${String(issued).padStart(4, '0')}`,
            tool_name: name,
            ...sent,
          }),
        ];
      } else {
        rows = rows.map((row, i) => (i === at ? { ...row, ...sent } : row));
      }
      return json(200, { tool_name: name, updated: true, ...sent });
    }
    const byName = /^\/v1\/tool\/(.+)$/.exec(url.pathname);
    if (byName !== null && request.method === 'GET') {
      const name = decodeURIComponent(byName[1] ?? '');
      const found = rows.find((row) => row['tool_name'] === name);
      return found === undefined || options.getSwallowsErrors === true
        ? json(404, { detail: `Tool '${name}' not found` })
        : json(200, found);
    }
    return json(404, { detail: 'not found' });
  });

  return { ...record, tools: () => rows.map((row) => ({ ...row })) };
};
