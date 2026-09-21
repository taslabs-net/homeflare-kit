/**
 * A fake Cloudflare `warp_connector` API for the MeshNode tests — an in-memory `fetch` handed to
 * Effect's real FetchHttpClient through its `Fetch` reference, so the tests exercise distilled's
 * real path assembly, query and body encoding, envelope decoding and error matching.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. The base URL is RFC 2606
 *   `api.example.com`, and any request outside `/accounts/<FAKE_ACCOUNT>/warp_connector` throws, so
 *   a mis-wired test fails instead of reaching a real API. The credentials are placeholders.
 * ★ THE NAME FILTER IS A SUBSTRING MATCH ON PURPOSE. The real filter's exactness is undocumented;
 *   a loose fake proves the client re-checks the exact name.
 * ★ PAGES OF TWO by default, so every lookup walks more than one page.
 */
import { fromApiToken } from '@distilled.cloud/cloudflare/Credentials';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export const FAKE_BASE = 'https://api.example.com/client/v4';
export const FAKE_ACCOUNT = '00000000000000000000000000000001';
/** ⚠️ A placeholder, not a credential. Tests assert it is what the SDK sends. */
export const FAKE_API_TOKEN = 'placeholder-api-token';

export type FakeNode = {
  id: string;
  name: string;
  ha: boolean;
  status: string;
  token: string;
  deleted_at: string | null;
};

export type Seen = { readonly method: string; readonly path: string; readonly body: unknown };

const ok = (result: unknown, extra: Record<string, unknown> = {}) =>
  Response.json({ success: true, errors: [], messages: [], result, ...extra });

const fail = (status: number, code: number, message: string) =>
  Response.json(
    { success: false, errors: [{ code, message }], messages: [], result: null },
    { status },
  );

/** The wire shape of a node, as the API documents it — plus `token` on create, as the HA page says. */
const wire = (node: FakeNode) => ({
  id: node.id,
  account_tag: FAKE_ACCOUNT,
  created_at: '2026-09-21T00:00:00Z',
  deleted_at: node.deleted_at,
  name: node.name,
  status: node.status,
  tun_type: 'warp_connector',
});

export const fakeMesh = (options: { readonly perPage?: number } = {}) => {
  const nodes = new Map<string, FakeNode>();
  const seen: Seen[] = [];
  const auth: string[] = [];
  let next = 1;
  const live = () => [...nodes.values()].filter((node) => node.deleted_at === null);

  const seed = (node: Partial<FakeNode> & { name: string }): FakeNode => {
    const id = node.id ?? `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
    const full: FakeNode = {
      id,
      ha: false,
      status: 'inactive',
      token: `fake-node-token-${id}`,
      deleted_at: null,
      ...node,
    };
    nodes.set(id, full);
    return full;
  };

  const route = (method: string, url: URL, body: Record<string, unknown>): Response => {
    const prefix = `/client/v4/accounts/${FAKE_ACCOUNT}/warp_connector`;
    if (url.host !== 'api.example.com' || !url.pathname.startsWith(prefix)) {
      throw new Error(`fake-mesh: unexpected request ${method} ${url.href}`);
    }
    const [id, sub] = url.pathname.slice(prefix.length).split('/').filter(Boolean);
    if (id === undefined && method === 'GET') {
      const filter = url.searchParams.get('name') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? options.perPage ?? 2);
      const hits = live().filter((node) => node.name.includes(filter));
      const slice = hits.slice((page - 1) * perPage, page * perPage);
      return ok(slice.map(wire), { result_info: { page, per_page: perPage, count: slice.length } });
    }
    if (id === undefined && method === 'POST') {
      const name = String(body['name']);
      if (live().some((node) => node.name === name)) {
        return fail(409, 1013, 'Tunnel with name already exists');
      }
      const node = seed({ name, ha: body['ha'] === true });
      return ok({ ...wire(node), token: node.token });
    }
    const node = id === undefined ? undefined : nodes.get(id);
    if (node === undefined) return fail(404, 1002, 'Tunnel not found');
    if (sub === 'token' && method === 'GET') return ok(node.token);
    if (sub !== undefined) throw new Error(`fake-mesh: unexpected ${method} ${url.pathname}`);
    if (method === 'GET') return ok(wire(node));
    if (method === 'PATCH') {
      const name = String(body['name']);
      if (live().some((other) => other.name === name && other.id !== node.id)) {
        return fail(409, 1013, 'Tunnel with name already exists');
      }
      node.name = name;
      return ok(wire(node));
    }
    if (method === 'DELETE') {
      if (node.deleted_at !== null) return fail(404, 1002, 'Tunnel not found');
      node.deleted_at = '2026-09-21T01:00:00Z';
      return ok(wire(node));
    }
    throw new Error(`fake-mesh: unexpected ${method} ${url.pathname}`);
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

  return { auth, fetch, live, nodes, seed, seen };
};

export type FakeMesh = ReturnType<typeof fakeMesh>;

/** distilled Credentials + the real FetchHttpClient over the fake — what a Bun script provides. */
export const fakeClientLayer = (fake: FakeMesh) =>
  Layer.mergeAll(
    fromApiToken({ apiToken: FAKE_API_TOKEN, apiBaseUrl: FAKE_BASE }),
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, fake.fetch),
  );

/** …plus the account, as Alchemy's CloudflareEnvironment hands it to a provider. */
export const fakeProviderLayer = (fake: FakeMesh, accountId: string = FAKE_ACCOUNT) =>
  Layer.mergeAll(
    fakeClientLayer(fake),
    Layer.succeed(
      Cloudflare.CloudflareEnvironment,
      Effect.succeed({
        type: 'apiToken' as const,
        apiToken: Redacted.make(FAKE_API_TOKEN),
        accountId,
        source: { type: 'env' as const },
      }),
    ),
  );
