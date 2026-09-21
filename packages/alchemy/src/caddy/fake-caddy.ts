/**
 * A fake Caddy admin API for the tests beside it — `Bun.serve` on an ephemeral 127.0.0.1 port (or a
 * unix socket), answering `/adapt`, `/load` and `/config/` the way caddyserver/caddy v2.11.4 does.
 *
 * ⛔ TEST-ONLY. No provider imports this file, and it never forwards anywhere.
 * ★ WHAT IS FAITHFUL, because the provider depends on it (see admin-calls.ts and digest.ts):
 *   · `/adapt` answers the adapter's STRUCT key order (unsorted); `/config/` answers SORTED keys,
 *     `<` escaped as `\u003c`, and a trailing newline — the differences the digest must erase.
 *   · A refused `/load` keeps the old config. With adapter warnings, the refusal comes in a 200
 *     whose body is the warnings followed by the error (load.go).
 *   · The Host check (admin.go checkHost) and the Origin check when one is sent.
 * ★ THE TOY ADAPTER. A Caddyfile here is lines; each becomes a route. Keywords steer the fake:
 *   `SYNTAX_ERROR` fails the adapt; `PROVISION_ERROR` adapts but fails the load; a TAB anywhere is
 *   "not formatted" (the warning real Caddy gives unformatted input); `admin <listen>`,
 *   `admin off` and `origins <a> <b>` set the adapted `admin` block.
 */
export type Seen = {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
};

export type FakeCaddy = {
  /** An address localCaddyAdmin() takes. */
  readonly address: string;
  readonly port: number;
  readonly seen: Seen[];
  /** The running config as a parsed object (null when empty). */
  running: unknown;
  /** Adapt with the toy adapter — to stage a "restart with a different file". */
  adapt(caddyfile: string): unknown;
  stop(): void;
};

const json = (status: number, body: unknown) =>
  new Response(`${JSON.stringify(body)}\n`, {
    headers: { 'content-type': 'application/json' },
    status,
  });

/** The toy adapter: struct key order on purpose (`routes` before `listen`, `apps` before `admin`). */
const toyAdapt = (text: string): { config?: unknown; error?: string; warnings: unknown[] } => {
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
  const at = lines.findIndex((line) => line.includes('SYNTAX_ERROR'));
  if (at !== -1)
    return { error: `Caddyfile:${String(at + 1)} - Error during parsing`, warnings: [] };
  const admin: Record<string, unknown> = {};
  const routes: unknown[] = [];
  for (const line of lines) {
    const [word, ...rest] = line.trim().split(/\s+/);
    if (word === 'admin' && rest[0] === 'off') admin['disabled'] = true;
    else if (word === 'admin') admin['listen'] = rest[0];
    else if (word === 'origins') admin['origins'] = rest;
    else routes.push({ match: [{ host: [word] }], handle: [{ handler: 'static', body: line }] });
  }
  const warnings = text.includes('\t')
    ? [{ file: 'Caddyfile', line: 1, message: 'Caddyfile input is not formatted' }]
    : [];
  const config = {
    apps: { http: { servers: { srv0: { routes, listen: [':443'] } } } },
    ...(Object.keys(admin).length === 0 ? {} : { admin }),
  };
  return { config, warnings };
};

/** Go's generic re-marshal: sorted keys, `<>&` escaped. */
const goEncode = (value: unknown): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : typeof v === 'object' && v !== null
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
};

export const fakeCaddy = (
  options: { unix?: string; running?: unknown; origins?: string[] } = {},
): FakeCaddy => {
  const seen: Seen[] = [];
  let port = 0;
  const state: { running: unknown } = { running: options.running ?? null };
  const allowedHosts = () =>
    options.origins ?? [
      `localhost:${String(port)}`,
      `[::1]:${String(port)}`,
      `127.0.0.1:${String(port)}`,
    ];

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const body = await request.text();
    seen.push({ body, headers: request.headers, method: request.method, path: url.pathname });
    if (options.unix === undefined) {
      const host = request.headers.get('host') ?? '';
      if (!allowedHosts().includes(host)) return json(403, { error: `host not allowed: ${host}` });
      const origin = request.headers.get('origin');
      if (origin !== null && !allowedHosts().includes(new URL(origin).host)) {
        return json(403, { error: `client is not allowed to access from origin '${origin}'` });
      }
    }
    if (url.pathname === '/config/' && request.method === 'GET') {
      return new Response(`${goEncode(state.running)}\n`, { status: 200 });
    }
    const type = request.headers.get('content-type') ?? '';
    if (request.method !== 'POST' || type !== 'text/caddyfile')
      return json(400, { error: 'unexpected' });
    const adapted = toyAdapt(body);
    if (adapted.error !== undefined) return json(400, { error: adapted.error });
    if (url.pathname === '/adapt') {
      const out = adapted.warnings.length > 0 ? { warnings: adapted.warnings } : {};
      return json(200, { ...out, result: adapted.config });
    }
    if (url.pathname !== '/load') return json(404, { error: 'not found' });
    const prefix = adapted.warnings.length > 0 ? JSON.stringify(adapted.warnings) : '';
    if (body.includes('PROVISION_ERROR')) {
      const error = JSON.stringify({
        error: 'loading config: provision http: listen tcp :443: address already in use',
      });
      // ⛔ load.go: warnings written first commit a 200; the error rides after them.
      return prefix === ''
        ? new Response(`${error}\n`, { status: 400 })
        : new Response(`${prefix}${error}\n`, { status: 200 });
    }
    state.running = JSON.parse(goEncode(adapted.config));
    return new Response(prefix, { status: 200 });
  };

  const server =
    options.unix === undefined
      ? Bun.serve({ fetch: handle, hostname: '127.0.0.1', port: 0 })
      : Bun.serve({ fetch: handle, unix: options.unix });
  port = server.port ?? 0;
  return {
    adapt: (caddyfile) => toyAdapt(caddyfile).config,
    address:
      options.unix === undefined ? `http://127.0.0.1:${String(port)}` : `unix://${options.unix}`,
    get running() {
      return state.running;
    },
    set running(value: unknown) {
      state.running = value;
    },
    port,
    seen,
    stop: () => void server.stop(true),
  };
};
