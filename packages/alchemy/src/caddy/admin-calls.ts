/**
 * The three admin API calls the provider makes, each classified into a value or a readable Error
 * that carries Caddy's own message.
 *
 * Read in caddyserver/caddy v2.11.4 (and the API docs, caddyserver.com/docs/api):
 *   · `POST /adapt` — adapts without running (load.go handleAdapt): 200 `{warnings?, result}`,
 *     or 400 `{"error": …}`. Side-effect free, so it is what plan-time validation uses.
 *   · `POST /load` — Content-Type `text/caddyfile` picks the adapter (load.go adaptByContentType);
 *     "if the new config fails for any reason, the old config is rolled back into place without
 *     downtime" (docs; caddy.go changeConfig restores the previous raw config). An identical
 *     config is a no-op without `Cache-Control: must-revalidate`.
 *   · `GET /config/` — the running config as JSON, `null` when empty (admin.go handleConfig).
 * ⛔ A FAILED LOAD CAN ANSWER 200. load.go writes the adapter's WARNINGS to the body before it
 *   runs the config; if the run then fails, the error JSON is appended to a response whose status
 *   is already 200 (Go's first Write sends 200; the later WriteHeader(400) is ignored). The
 *   Caddyfile adapter warns on every unformatted input (adapter.go FormattingDifference), so this
 *   is the COMMON failure shape, not an edge. Hence: look for the error in the body whatever the
 *   status — and the lifecycle reads the config back after every load anyway.
 *   MEASURED 2026-09-21 on a throwaway Caddy 2.11.4 (loopback ports, isolated XDG dirs): an
 *   unformatted Caddyfile whose port was taken answered `200` with body
 *   `[{"file":"Caddyfile","line":8,"message":"Caddyfile input is not formatted; …"}]{"error":"loading
 *   config: … bind: address already in use"}`, and Caddy kept serving the previous config.
 */
import type { CaddyAdmin, CaddyAdminResponse } from './admin.ts';
import { parseConfig } from './digest.ts';

export class CaddyAdminError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    reason: string,
  ) {
    super(`Caddy ${method} ${path} → ${String(status)}: ${reason}`);
    this.name = 'CaddyAdminError';
  }
}

const CADDYFILE = 'text/caddyfile';
/** APIError marshals as exactly this key (admin.go APIError, `json:"error"`). */
const ERROR_OPEN = '{"error":';

type Warning = { file?: string; line?: number; message?: string };

const describe = (warning: Warning): string =>
  `${warning.file ?? 'Caddyfile'}:${String(warning.line ?? 0)}: ${warning.message ?? '(no message)'}`;

/** Caddy's `error` string from a body that holds one, or `undefined`. */
const errorIn = (body: string): string | undefined => {
  const at = body.lastIndexOf(ERROR_OPEN);
  if (at === -1) return undefined;
  try {
    const parsed = JSON.parse(body.slice(at)) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
};

const warningsIn = (text: string): string[] => {
  if (text.trim() === '') return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Warning[]).map(describe) : [];
  } catch {
    return [];
  }
};

const fail = (response: CaddyAdminResponse, method: string, path: string): never => {
  const reason = errorIn(response.body) ?? (response.body.trim().slice(0, 500) || '(empty body)');
  // ⚠️ Say so when the status lied (the ⛔ above), or "→ 200" reads like success.
  const shown = response.status === 200 ? `${reason} (error in a 200 body)` : reason;
  throw new CaddyAdminError(response.status, method, path, shown);
};

export type Adapted = { readonly config: unknown; readonly warnings: readonly string[] };

/** Adapt a Caddyfile to JSON on the running Caddy, without loading it. */
export const adaptCaddyfile = async (admin: CaddyAdmin, caddyfile: string): Promise<Adapted> => {
  const response = await admin.request({
    body: caddyfile,
    headers: { 'Content-Type': CADDYFILE },
    method: 'POST',
    path: '/adapt',
  });
  // ★ Status alone here: /adapt writes its body once, and a successful result is config JSON in
  //   which an `error` handler's key could look like an error object to a substring search.
  if (response.status !== 200) fail(response, 'POST', '/adapt');
  const parsed = JSON.parse(response.body) as { result?: unknown; warnings?: Warning[] };
  return { config: parsed.result ?? null, warnings: (parsed.warnings ?? []).map(describe) };
};

/** The running config, parsed; `null` when Caddy runs with none. */
export const readRunningConfig = async (admin: CaddyAdmin): Promise<unknown> => {
  const response = await admin.request({ method: 'GET', path: '/config/' });
  if (response.status !== 200) fail(response, 'GET', '/config/');
  return parseConfig(response.body);
};

/**
 * Apply a Caddyfile with `POST /load`; resolves with the adapter's warnings.
 *
 * ★ `sourceFile` RIDES AS `Caddy-Config-Source-File` (+ `-Adapter: caddyfile`), the headers
 *   `caddy reload` sends (cmd/commandfuncs.go). A load WITHOUT them makes Caddy forget the file it
 *   was started with (caddy.go ClearLastConfigIfDifferent), and SIGUSR1 then no longer reloads
 *   from that file. With them, and the same path, it keeps it.
 */
export const loadCaddyfile = async (
  admin: CaddyAdmin,
  caddyfile: string,
  sourceFile?: string,
): Promise<readonly string[]> => {
  const response = await admin.request({
    body: caddyfile,
    headers: {
      'Content-Type': CADDYFILE,
      ...(sourceFile === undefined
        ? {}
        : { 'Caddy-Config-Source-Adapter': 'caddyfile', 'Caddy-Config-Source-File': sourceFile }),
    },
    method: 'POST',
    path: '/load',
  });
  const refused = errorIn(response.body);
  if (response.status !== 200 || refused !== undefined) fail(response, 'POST', '/load');
  return warningsIn(response.body);
};
