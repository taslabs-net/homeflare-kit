/**
 * A fake of LiteLLM's `/config/pass_through_endpoint` routes for tests — TEST ONLY, never imported
 * by `index.ts` (the netbox/forgejo house convention for test-only helpers). Mirrors
 * `../netbox/fake-netbox.ts`/`../forgejo/fake-forgejo.ts`: a `fetch` function handed to Effect's
 * real `FetchHttpClient` through its `Fetch` reference, so a test exercises distilled's REAL path
 * assembly, JSON encode/decode and status→typed-error matching (`BadRequest`, `NotFound`, …) —
 * nothing about that matching is re-implemented here, only the wire responses a scenario needs.
 *
 * ★ MODELS THE WHOLE-FIELD READ-MODIFY-WRITE ON PURPOSE. `general_settings.pass_through_endpoints`
 *   is ONE field (operations.ts's header), so every mutation here reads the CURRENT row list,
 *   awaits (so two concurrent calls can interleave — no real socket needed, `fetch` is just an
 *   async function the runtime awaits), then writes back what it captured — not what is there by
 *   the time it writes. Two `create` calls that race lose one row, exactly like the vendor field
 *   would without `operations.ts`'s per-base-URL semaphore serialising them.
 * ⚠️ WHAT THIS FAKE DOES NOT MODEL: PROXY_ADMIN vs. a lesser role for most routes (any correct
 *   bearer token is accepted). `forbidDelete` is the one exception: it models the real asymmetry
 *   `operations.ts`'s header describes — `DELETE` routes through `update_config_general_settings`,
 *   which 400s `not_allowed_access` for a non-PROXY_ADMIN caller (or a disconnected DB) on a row
 *   that is genuinely still live, the SAME status a missing-id delete gets (proxy_server.py:
 *   16389-16416 at v1.100.0).
 * ⚠️ UPDATE-OF-A-MISSING-ID IS 404, NOT 400 — corrected by this migration. The retired hand-rolled
 *   fake 400'd it as "not measured at the tag, a documented test simplification". The distilled
 *   SDK's own `patches/misc/update_pass_through_endpoints_*.json` cites the real source
 *   (`pass_through_endpoints.py`'s `update_pass_through_endpoints` at the tag): unlike DELETE, this
 *   route raises a genuine, unambiguous `HTTPException(404)` for a missing id, distinct from the
 *   400 `update_config_general_settings` raises for the trailing auth/DB-disconnected write. This
 *   fake now matches that measured vendor behaviour.
 */
import type { PassThroughGenericEndpoint } from '@distilled.cloud/litellm/misc';

/** RFC 2606 placeholder — never a real host. Shared across tests, like `../netbox/fake-netbox.ts`. */
export const FAKE_BASE = 'https://litellm.example.com';

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
}

export interface FakeLitellm {
  readonly fetch: typeof globalThis.fetch;
  readonly rows: () => readonly PassThroughGenericEndpoint[];
  readonly requests: () => readonly FakeRequest[];
}

const RACE_WINDOW_MS = 15;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });

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

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${masterKey}`) return json(401, { detail: 'invalid api key' });
    if (
      url.pathname !== '/config/pass_through_endpoint' &&
      !url.pathname.startsWith('/config/pass_through_endpoint/')
    ) {
      return json(404, { detail: 'not found' });
    }

    if (request.method === 'GET') {
      const endpointId = url.searchParams.get('endpoint_id');
      const filtered = endpointId === null ? rows : rows.filter((row) => row.id === endpointId);
      return json(200, { endpoints: filtered });
    }

    if (request.method === 'POST' && url.pathname === '/config/pass_through_endpoint') {
      const body = (await request.json()) as PassThroughGenericEndpoint;
      const before = rows; // ★ captured before the window — the race the semaphore prevents
      await sleep(RACE_WINDOW_MS);
      rows = [...before, { ...body, is_from_config: false }];
      return json(200, { body: {} });
    }

    if (request.method === 'POST' && url.pathname.startsWith('/config/pass_through_endpoint/')) {
      const id = decodeURIComponent(url.pathname.slice('/config/pass_through_endpoint/'.length));
      const patch = (await request.json()) as Partial<PassThroughGenericEndpoint>;
      const before = rows;
      await sleep(RACE_WINDOW_MS);
      const index = before.findIndex((row) => row.id === id);
      // ⚠️ 404, not 400 — see the file header.
      if (index === -1) return json(404, { detail: `Endpoint with ID '${id}' not found` });
      // ⚠️ `exclude_none`-shaped: only keys the patch actually carries are merged, matching
      //   operations.ts's `updateBody` never sending an unset/null field (pass-through-form.ts).
      const merged = { ...before[index], ...patch };
      rows = before.map((row, i) => (i === index ? (merged as PassThroughGenericEndpoint) : row));
      return json(200, { body: {} });
    }

    if (request.method === 'DELETE' && url.pathname === '/config/pass_through_endpoint') {
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

    return json(405, { detail: `unhandled ${request.method} ${url.pathname}` });
  }) as typeof globalThis.fetch;

  return { fetch, requests: () => [...requests], rows: () => [...rows] };
};
