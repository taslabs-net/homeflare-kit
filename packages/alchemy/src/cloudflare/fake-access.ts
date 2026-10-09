/**
 * A fake Cloudflare Access applications API for the SaasOidcApplication tests — an in-memory
 * `fetch` handed to Effect's real FetchHttpClient (see fake-mesh.ts, which this mirrors), so the
 * tests exercise distilled's real path assembly, body encoding and envelope decoding AND the raw
 * read in saas-oidc-api.ts.
 *
 * ⛔ TEST-ONLY, AND NO NETWORK. No provider imports this file. Any request outside
 *   `/accounts/<FAKE_ACCOUNT>/access/apps` throws, so a mis-wired test fails instead of reaching a
 *   real API. Every credential-looking value is a placeholder.
 * ★ THE WIRE IS CLOUDFLARE'S, snake_case: `saas_app`, `client_id`, `redirect_uris`… The create
 *   response carries `saas_app.client_secret` (the SDK schema's own doc: "only returned on POST
 *   request"); a GET and a PUT never do. So a test that asserts the secret appears nowhere is
 *   asserting against a fake that does hand it out once.
 * ★ THE LIST IS PAGES OF TWO by default, so every name lookup walks more than one page.
 * ★ THE ORGANIZATION READ (`GET /access/organizations`, the pre-create team check) answers with the
 *   fake's own team by default; `org` makes it answer a different domain, a 403 in either of the
 *   two shapes a token without the permission can get (code 10000 and 10001, see
 *   saas-oidc-team.ts), or a 404.
 * ★ `malformed` makes the named calls answer a 2xx body the SDK's STRICT validation cannot decode,
 *   with `FAKE_CLIENT_SECRET` planted in it, so a test can force `CloudflareParseError` and look
 *   for the secret in what this package throws. ⚠️ ONLY THE CALLS rc.13 TYPES CAN BE MADE TO FAIL:
 *   a create or update response decodes against `S.Unknown` (zero_trust.ts:35025, :210218), which
 *   accepts anything, so those two are not offered here (saas-oidc-parse-error.test.ts reaches them
 *   through the `sdkWrites` seam instead). `list` fails by answering an object where an array is
 *   expected, `delete` and `org` by answering a number where the schema wants a string.
 */
import { FAKE_ACCOUNT, fakeFailure } from './fake-mesh.ts';

export const TEAM = 'example.cloudflareaccess.com';
/** ⚠️ A placeholder, not a credential. Tests assert it is stored and logged nowhere. */
export const FAKE_CLIENT_SECRET = 'fake-client-secret-0123456789abcdef';

export type FakeApp = {
  id: string;
  aud: string;
  type: string;
  name: string;
  session_duration: string;
  policies: string[];
  saas_app?: Record<string, unknown> | undefined;
};

export type Seen = { readonly method: string; readonly path: string; readonly body: unknown };

/** The calls `malformed` can corrupt: `get` is the raw read, the rest are SDK calls. */
export type FakeOp = 'get' | 'list' | 'delete' | 'org';
/** How the organization read answers; an object names the `auth_domain` it returns. */
export type FakeOrg =
  | 'matching'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | { authDomain: string };

export type FakeOptions = {
  readonly perPage?: number;
  readonly team?: string;
  readonly org?: FakeOrg;
  readonly malformed?: ReadonlyArray<FakeOp>;
};

const ok = (result: unknown, extra: Record<string, unknown> = {}) =>
  Response.json({ success: true, errors: [], messages: [], result, ...extra });

/** The wire shape of an app: no `client_secret`, and `domain` as Cloudflare derives it. */
const wire = (app: FakeApp, team: string) => {
  const clientId = app.saas_app?.['client_id'];
  const { saas_app: saas, ...rest } = app;
  const { client_secret: _secret, ...publicSaas } = saas ?? {};
  return {
    ...rest,
    domain: typeof clientId === 'string' ? `${team}/cdn-cgi/access/sso/oidc/${clientId}` : 'x.test',
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
    policies: app.policies.map((id, i) => ({ id, precedence: i + 1 })),
    ...(saas === undefined ? {} : { saas_app: publicSaas }),
  };
};

/**
 * A 2xx `result` the typed decoders reject (`id` and `auth_domain` are numbers, and it is not an
 * array), carrying the secret where a create puts it.
 */
const garbage = () => ({
  id: 12345,
  auth_domain: 12345,
  client_secret: FAKE_CLIENT_SECRET,
  saas_app: { client_secret: FAKE_CLIENT_SECRET },
});

const orgBody = (org: FakeOrg, team: string): Response => {
  if (org === 'unauthorized') return fakeFailure(403, 10000, 'Authentication error');
  if (org === 'forbidden') return fakeFailure(403, 10001, 'Method not allowed for token');
  if (org === 'not_found') return fakeFailure(404, 12004, 'access.api.error.not_found');
  const authDomain = org === 'matching' ? team : org.authDomain;
  return ok({ auth_domain: authDomain, name: 'team', session_duration: '24h' });
};

export const fakeAccess = (options: FakeOptions = {}) => {
  const team = options.team ?? TEAM;
  const broken = (op: FakeOp): boolean => options.malformed?.includes(op) ?? false;
  const apps = new Map<string, FakeApp>();
  const seen: Seen[] = [];
  let next = 1;

  const seed = (app: Partial<FakeApp> & { name: string }): FakeApp => {
    const n = String(next++).padStart(12, '0');
    const full: FakeApp = {
      id: `00000000-0000-4000-8000-${n}`,
      aud: `aud-${n}`,
      type: 'saas',
      session_duration: '24h',
      policies: [],
      ...app,
    };
    if (full.type === 'saas' && full.saas_app?.['client_id'] === undefined) {
      full.saas_app = { auth_type: 'oidc', client_id: `client-${n}`, ...full.saas_app };
    }
    apps.set(full.id, full);
    return full;
  };

  const route = (method: string, url: URL, body: Record<string, unknown>): Response => {
    const prefix = `/client/v4/accounts/${FAKE_ACCOUNT}/access/apps`;
    if (
      url.host === 'api.example.com' &&
      url.pathname === prefix.replace(/apps$/, 'organizations')
    ) {
      if (method !== 'GET') throw new Error(`fake-access: unexpected ${method} ${url.pathname}`);
      return broken('org') ? ok(garbage()) : orgBody(options.org ?? 'matching', team);
    }
    if (url.host !== 'api.example.com' || !url.pathname.startsWith(prefix)) {
      throw new Error(`fake-access: unexpected request ${method} ${url.href}`);
    }
    const id = url.pathname.slice(prefix.length).split('/').filter(Boolean)[0];
    if (id === undefined && method === 'GET') {
      if (broken('list')) return ok(garbage());
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? options.perPage ?? 2);
      const all = [...apps.values()];
      const slice = all.slice((page - 1) * perPage, page * perPage);
      return ok(
        slice.map((app) => wire(app, team)),
        {
          result_info: { page, per_page: perPage, count: slice.length, total_count: all.length },
        },
      );
    }
    if (id === undefined && method === 'POST') {
      const app = seed({
        name: String(body['name']),
        type: String(body['type']),
        policies: (body['policies'] as string[] | undefined) ?? [],
        saas_app: body['saas_app'] as Record<string, unknown> | undefined,
      });
      // ⛔ The one response that hands the secret out, as the API does on POST.
      const created = wire(app, team) as Record<string, unknown>;
      created['saas_app'] = {
        ...(created['saas_app'] as object),
        client_secret: FAKE_CLIENT_SECRET,
      };
      return ok(created);
    }
    const app = id === undefined ? undefined : apps.get(id);
    if (app === undefined) return fakeFailure(404, 12006, 'access.api.error.unknown_application');
    if (method === 'GET') {
      return broken('get') ? new Response(`not json ${FAKE_CLIENT_SECRET}`) : ok(wire(app, team));
    }
    if (method === 'PUT') {
      app.name = String(body['name']);
      app.policies = (body['policies'] as string[] | undefined) ?? [];
      app.saas_app = { ...app.saas_app, ...(body['saas_app'] as Record<string, unknown>) };
      return ok(wire(app, team));
    }
    if (method === 'DELETE') {
      if (broken('delete')) return ok(garbage());
      apps.delete(app.id);
      return ok({ id: app.id });
    }
    throw new Error(`fake-access: unexpected ${method} ${url.pathname}`);
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
    seen.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
    return route(request.method, url, body);
  }) as typeof globalThis.fetch;

  return { apps, fetch, seed, seen, team };
};

export type FakeAccess = ReturnType<typeof fakeAccess>;
