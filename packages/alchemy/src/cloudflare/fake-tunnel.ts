/**
 * A fake Cloudflare `cfd_tunnel` API for the CloudflaredTunnel tests — an in-memory `fetch` handed
 * to Effect's real FetchHttpClient, the same way fake-mesh.ts does it, so the tests exercise
 * distilled's real path assembly, query and body encoding, envelope decoding and error matching.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. Any request outside
 *   `/accounts/<FAKE_ACCOUNT>/cfd_tunnel` or `/accounts/<FAKE_ACCOUNT>/tunnels` throws, so a
 *   mis-wired test fails instead of reaching a real API.
 * ★ THE FAKE HANDS OUT A TOKEN ON EVERY SURFACE IT CAN: a `token` field on the create response and
 *   on every wire object (worst case: if Cloudflare ever adds one to the documented shape), and the
 *   `/token` endpoint. The tests then prove none of it reaches an attribute, a state row or a
 *   request log. The SDK's decoder drops fields outside its schema; the provider must not depend on
 *   that alone.
 * ★ THE NAME FILTER IS A SUBSTRING MATCH, as in fake-mesh.ts, so the client's exact re-check is
 *   exercised. `/tunnels` honours `tun_types` and `is_deleted` as the SDK documents them, and
 *   answers pages of two by default.
 */
import { FAKE_ACCOUNT, type Seen, fakeFailure, ok } from './fake-mesh.ts';

export type FakeTunnel = {
  id: string;
  name: string;
  tun_type: string;
  config_src: string;
  status: string;
  token: string;
  deleted_at: string | null;
  /** The fake refuses a DELETE while this is set, as the SDK doc says it must ("no active connections"). */
  connected: boolean;
};

const wire = (tunnel: FakeTunnel) => ({
  id: tunnel.id,
  account_tag: FAKE_ACCOUNT,
  config_src: tunnel.config_src,
  created_at: '2026-10-09T00:00:00Z',
  deleted_at: tunnel.deleted_at,
  name: tunnel.name,
  status: tunnel.status,
  tun_type: tunnel.tun_type,
  token: tunnel.token,
});

export type FakeTunnelOptions = {
  readonly perPage?: number;
  /** Return a Response to answer the POST with it instead (e.g. `fakeFailure(409, 1013, …)`). */
  readonly onCreate?: (name: string) => Response | void;
};

export const fakeTunnels = (options: FakeTunnelOptions = {}) => {
  const tunnels = new Map<string, FakeTunnel>();
  const seen: Seen[] = [];
  const auth: string[] = [];
  let next = 1;
  const live = () => [...tunnels.values()].filter((t) => t.deleted_at === null);

  const seed = (tunnel: Partial<FakeTunnel> & { name: string }): FakeTunnel => {
    const id = tunnel.id ?? `00000000-0000-4000-9000-${String(next++).padStart(12, '0')}`;
    const full: FakeTunnel = {
      id,
      tun_type: 'cfd_tunnel',
      config_src: 'cloudflare',
      status: 'inactive',
      token: `fake-tunnel-token-${id}`,
      deleted_at: null,
      connected: false,
      ...tunnel,
    };
    tunnels.set(id, full);
    return full;
  };

  const list = (url: URL): Response => {
    const filter = url.searchParams.get('name') ?? '';
    const types = (url.searchParams.get('tun_types') ?? '').split(',').filter(Boolean);
    const isDeleted = url.searchParams.get('is_deleted');
    const page = Number(url.searchParams.get('page') ?? '1');
    const perPage = Number(url.searchParams.get('per_page') ?? options.perPage ?? 2);
    const hits = [...tunnels.values()]
      .filter((t) => types.length === 0 || types.includes(t.tun_type))
      .filter((t) => isDeleted === null || (t.deleted_at !== null) === (isDeleted === 'true'))
      .filter((t) => t.name.includes(filter));
    const slice = hits.slice((page - 1) * perPage, page * perPage);
    return ok(slice.map(wire), { result_info: { page, per_page: perPage, count: slice.length } });
  };

  const route = (method: string, url: URL, body: Record<string, unknown>): Response => {
    const base = `/client/v4/accounts/${FAKE_ACCOUNT}`;
    if (url.host !== 'api.example.com' || !url.pathname.startsWith(base)) {
      throw new Error(`fake-tunnel: unexpected request ${method} ${url.href}`);
    }
    const rest = url.pathname.slice(base.length);
    if (rest === '/tunnels' && method === 'GET') return list(url);
    if (!rest.startsWith('/cfd_tunnel')) {
      throw new Error(`fake-tunnel: unexpected ${method} ${url.pathname}`);
    }
    const [id, sub] = rest.slice('/cfd_tunnel'.length).split('/').filter(Boolean);
    if (id === undefined && method === 'POST') {
      const name = String(body['name']);
      const override = options.onCreate?.(name);
      if (override !== undefined) return override;
      if (live().some((t) => t.name === name)) {
        return fakeFailure(409, 1013, 'tunnel with name already exists');
      }
      const tunnel = seed({ name, config_src: String(body['config_src'] ?? 'local') });
      return ok(wire(tunnel));
    }
    const tunnel = id === undefined ? undefined : tunnels.get(id);
    if (tunnel === undefined) return fakeFailure(404, 1002, 'Tunnel not found');
    if (sub === 'token' && method === 'GET') return ok(tunnel.token);
    if (sub !== undefined) throw new Error(`fake-tunnel: unexpected ${method} ${url.pathname}`);
    if (method === 'GET') return ok(wire(tunnel));
    if (method === 'PATCH') {
      const name = String(body['name']);
      if (live().some((other) => other.name === name && other.id !== tunnel.id)) {
        return fakeFailure(409, 1013, 'tunnel with name already exists');
      }
      tunnel.name = name;
      return ok(wire(tunnel));
    }
    if (method === 'DELETE') {
      if (tunnel.deleted_at !== null) return fakeFailure(404, 1002, 'Tunnel not found');
      if (tunnel.connected) return fakeFailure(400, 1000, 'tunnel has active connections');
      tunnel.deleted_at = '2026-10-09T01:00:00Z';
      return ok(wire(tunnel));
    }
    throw new Error(`fake-tunnel: unexpected ${method} ${url.pathname}`);
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
    seen.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
    auth.push(request.headers.get('authorization') ?? '');
    return route(request.method, url, body);
  }) as typeof globalThis.fetch;

  return { auth, fetch, live, tunnels, seed, seen };
};

export type FakeTunnels = ReturnType<typeof fakeTunnels>;
