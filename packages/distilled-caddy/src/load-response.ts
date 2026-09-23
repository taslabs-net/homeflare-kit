/**
 * `POST /load`'s 200-with-embedded-error quirk — isolated from protocol.ts
 * so that file stays a plain request/response cascade.
 *
 * SOURCE (caddyserver/caddy v2.11.4, caddyconfig/load.go `handleLoad`):
 * when the request carries a `Content-Type` (an adapter is in play, e.g.
 * `text/caddyfile`), the adapter's warnings are marshaled and `w.Write`n
 * BEFORE `caddy.Load` runs (load.go lines ~96-111). Go commits the response
 * status on the FIRST `Write`, so that write sends 200. If `caddy.Load` then
 * fails (line ~116-122), the handler returns an `APIError{HTTPStatus: 400}`;
 * the shared `adminHandler.handleError` (admin.go `handleError`, lines
 * ~885-919) calls `w.WriteHeader(400)`, which is a no-op because headers
 * are already sent, and then JSON-encodes `{"error": "…"}` — appended
 * straight after the warnings array already on the wire, with no
 * separator. The body is therefore TWO concatenated JSON values, which
 * `JSON.parse` rejects outright (Caddyfile's adapter warns on any
 * unformatted input — adapter.go `FormattingDifference` — so this is the
 * COMMON failure shape for a hand-edited Caddyfile, not a rare edge case).
 *
 * The Caddyfile adapter warns on EVERY unformatted input, so a body ending
 * in `{"error": …}` after a warnings array is unambiguous: on a genuine
 * success the handler never writes anything past the warnings JSON. This
 * mirrors an independent measurement against a throwaway Caddy 2.11.4
 * (loopback ports, isolated XDG dirs) recorded in the kit's
 * `packages/alchemy/src/caddy/admin-calls.ts`, which observed exactly this
 * two-JSON-values body for an unformatted Caddyfile whose port was taken.
 *
 * `/adapt` does NOT get this treatment (see protocol.ts): it writes its
 * body once, and a successful `result` can itself contain a handler whose
 * config literally has an `"error"` key — a status-only check is correct
 * there, and a body scan would false-positive on it.
 */

/** Caddy's `APIError` marshals as exactly this key (admin.go, `json:"error"`). */
const ERROR_OPEN = '{"error":';

export interface LoadWarning {
  readonly file?: string;
  readonly line?: number;
  readonly message?: string;
}

const describeWarning = (w: LoadWarning): string =>
  `${w.file ?? "Caddyfile"}:${String(w.line ?? 0)}: ${w.message ?? "(no message)"}`;

/**
 * The `error` string from a body that has one appended, scanning from the
 * END so a warning's own message text (which could itself contain the
 * literal substring `{"error":`) never shadows the real, later object.
 */
export const errorInLoadBody = (body: string): string | undefined => {
  const at = body.lastIndexOf(ERROR_OPEN);
  if (at === -1) return undefined;
  try {
    const parsed = JSON.parse(body.slice(at)) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The prefix before an appended error (`errorInLoadBody` found one), or the
 * whole body on a clean success — either way, the adapter's warnings JSON
 * array, still on the wire shape `POST /adapt` uses (`{file?, line?,
 * message?}[]`, matching `AdaptConfig`'s output for the same field).
 * Malformed/absent JSON reads as no warnings, never a throw.
 */
export const warningsInLoadBody = (body: string): readonly LoadWarning[] => {
  const at = body.lastIndexOf(ERROR_OPEN);
  const text = (at === -1 ? body : body.slice(0, at)).trim();
  if (text === "") return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as LoadWarning[]) : [];
  } catch {
    return [];
  }
};

/** Human-readable form of {@link warningsInLoadBody}, for `LoadRefused.warnings`. */
export const describedWarningsInLoadBody = (body: string): readonly string[] =>
  warningsInLoadBody(body).map(describeWarning);
