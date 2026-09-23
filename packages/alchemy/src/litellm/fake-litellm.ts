/**
 * A loopback `Bun.serve` fake of LiteLLM's `/config/pass_through_endpoint` routes — TEST ONLY,
 * never imported by `index.ts` (the netbox/proxmox house convention for test-only helpers).
 *
 * ★ MODELS THE WHOLE-FIELD READ-MODIFY-WRITE ON PURPOSE. `general_settings.pass_through_endpoints`
 *   is ONE field (client.ts's header), so every mutation here reads the CURRENT row list, waits
 *   (so two concurrent requests can interleave), then writes back what it captured — not what is
 *   there by the time it writes. Two `create` calls that race lose one row, exactly like the
 *   vendor field would without the client's per-base-URL semaphore serialising them.
 * ⚠️ WHAT THIS FAKE DOES NOT MODEL: PROXY_ADMIN vs. a lesser role for most routes (any correct
 *   bearer token is accepted); and update-of-a-missing-id, which is not measured at the tag — this
 *   fake 400s it, the same status a missing delete gets, as a documented TEST SIMPLIFICATION, not a
 *   vendor fact (docs/litellm.md says so too). `forbidDelete` is the one exception: it models the
 *   real asymmetry client.ts's header describes — `DELETE` routes through
 *   `update_config_general_settings`, which 400s `not_allowed_access` for a non-PROXY_ADMIN caller
 *   (or a disconnected DB) on a row that is genuinely still live, the SAME status a missing-id
 *   delete gets (proxy_server.py:16389-16416 at v1.100.0).
 */
import type { PassThroughGenericEndpoint } from './generated/pass-through.ts';

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
}

export interface FakeLitellm {
  readonly url: string;
  readonly rows: () => readonly PassThroughGenericEndpoint[];
  readonly requests: () => readonly FakeRequest[];
  readonly stop: () => void;
}

const RACE_WINDOW_MS = 15;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const startFakeLitellm = (options?: {
  readonly masterKey?: string;
  readonly seed?: readonly PassThroughGenericEndpoint[];
  /** Every `DELETE` 400s `not_allowed_access`, whether or not the row exists — see the file header. */
  readonly forbidDelete?: boolean;
}): FakeLitellm => {
  const masterKey = options?.masterKey ?? 'sk-test-master';
  const forbidDelete = options?.forbidDelete ?? false;
  let rows: PassThroughGenericEndpoint[] = [...(options?.seed ?? [])];
  const requests: FakeRequest[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      const auth = req.headers.get('authorization');
      if (auth !== `Bearer ${masterKey}`) return json(401, { detail: 'invalid api key' });
      if (
        url.pathname !== '/config/pass_through_endpoint' &&
        !url.pathname.startsWith('/config/pass_through_endpoint/')
      ) {
        return json(404, { detail: 'not found' });
      }

      if (req.method === 'GET') {
        const endpointId = url.searchParams.get('endpoint_id');
        const filtered = endpointId === null ? rows : rows.filter((row) => row.id === endpointId);
        return json(200, { endpoints: filtered });
      }

      if (req.method === 'POST' && url.pathname === '/config/pass_through_endpoint') {
        const body = (await req.json()) as PassThroughGenericEndpoint;
        const before = rows; // ★ captured before the window — the race the semaphore prevents
        await sleep(RACE_WINDOW_MS);
        rows = [...before, { ...body, is_from_config: false }];
        return json(200, {});
      }

      if (req.method === 'POST' && url.pathname.startsWith('/config/pass_through_endpoint/')) {
        const id = decodeURIComponent(url.pathname.slice('/config/pass_through_endpoint/'.length));
        const patch = (await req.json()) as Partial<PassThroughGenericEndpoint>;
        const before = rows;
        await sleep(RACE_WINDOW_MS);
        const index = before.findIndex((row) => row.id === id);
        if (index === -1) return json(400, { detail: `No pass-through endpoint with id=${id}` });
        // ⚠️ `exclude_none`-shaped: only keys the patch actually carries are merged, matching
        //   client.ts's `updateBody` never sending an unset/null field (pass-through-form.ts).
        const merged = { ...before[index], ...patch };
        rows = before.map((row, i) => (i === index ? (merged as PassThroughGenericEndpoint) : row));
        return json(200, {});
      }

      if (req.method === 'DELETE' && url.pathname === '/config/pass_through_endpoint') {
        const id = url.searchParams.get('endpoint_id');
        if (forbidDelete) return json(400, { error: 'not_allowed_access' });
        const before = rows;
        await sleep(RACE_WINDOW_MS);
        if (!before.some((row) => row.id === id)) {
          return json(400, { detail: `No pass-through endpoint with id=${String(id)}` });
        }
        rows = before.filter((row) => row.id !== id);
        return json(200, { endpoints: rows });
      }

      return json(405, { detail: `unhandled ${req.method} ${url.pathname}` });
    },
  });

  return {
    requests: () => [...requests],
    rows: () => [...rows],
    stop: () => server.stop(true),
    url: server.url.toString().replace(/\/$/, ''),
  };
};
