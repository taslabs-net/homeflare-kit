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
 *   `admin off` and `origins <a> <b>` set the adapted `admin` block. With no site lines there are
 *   no apps at all, as real Caddy adapts a Caddyfile of only comments or global options.
 * ★ `listenPort` is the port Caddy BELIEVES it listens on — its Host check uses it — while the
 *   fake really listens on an ephemeral one: a Caddy on its default :2019 behind a forward.
 */
import * as Effect from 'effect/Effect';
import type * as Caddy from '@distilled.cloud/caddy';
import { type CaddyAdminService, type CaddyTransport, caddyAdminLayer } from './admin.ts';
import { localCaddyAdmin } from './local-admin.ts';

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
    ...(routes.length === 0
      ? {}
      : { apps: { http: { servers: { srv0: { routes, listen: [':443'] } } } } }),
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
  options: { unix?: string; running?: unknown; origins?: string[]; listenPort?: number } = {},
): FakeCaddy => {
  const seen: Seen[] = [];
  let port = 0;
  const state: { running: unknown } = { running: options.running ?? null };
  const allowedHosts = () =>
    options.origins ??
    ['localhost', '[::1]', '127.0.0.1'].map(
      (host) => `${host}:${String(options.listenPort ?? port)}`,
    );

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
    // ⚠️ TEST-ONLY SCENARIO, no Caddy source it reproduces: a `/load` that answers 200 with no
    //   applied change at all (not even the embedded-error 200 the ⛔ above describes) — what
    //   config-lifecycle.ts's read-back-and-insist check exists to catch, per its own doc.
    if (body.includes('SWALLOW_LOAD')) return new Response('', { status: 200 });
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

/**
 * A fake Caddy on its DEFAULT :2019 behind a forward (`hostHeader`), and the transport to it.
 * ★ Addressed that way so a Caddyfile with no `admin` line — the common case — passes the guard.
 *   A Caddy reached on any other port needs `admin <address>` declared, or the first load would
 *   move it (admin-guard.ts).
 */
export const fakeDefaultCaddy = (
  running?: unknown,
): { admin: CaddyTransport; caddy: FakeCaddy } => {
  const caddy = fakeCaddy({ listenPort: 2019, ...(running === undefined ? {} : { running }) });
  const admin = localCaddyAdmin({
    address: caddy.address,
    hostHeader: '127.0.0.1:2019',
    retries: 0,
  });
  return { admin, caddy };
};

/**
 * Runs an Effect that needs `CaddyAdminService` and `@distilled.cloud/caddy`'s own `Credentials`/
 * `HttpClient` against one transport — the one line every test in this directory used to spend on
 * `Effect.provide(caddyAdminLayer(admin))` before this helper existed.
 */
export const runCaddy = <A, E>(
  effect: Effect.Effect<A, E, CaddyAdminService | Caddy.CaddyOpContext>,
  admin: CaddyTransport,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(caddyAdminLayer(admin))));
