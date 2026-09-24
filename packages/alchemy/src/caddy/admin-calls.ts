/**
 * The three admin API calls the provider makes, through `@distilled.cloud/caddy`'s typed `admin`
 * operations — `catchTag`-able errors, never a status check in this file.
 *
 * Read in caddyserver/caddy v2.11.4 (and the API docs, caddyserver.com/docs/api):
 *   · `POST /adapt` (`adaptConfig`) — adapts without running (load.go handleAdapt). Side-effect
 *     free, so it is what plan-time validation uses.
 *   · `POST /load` (`loadConfig`) — Content-Type `text/caddyfile` picks the adapter (load.go
 *     adaptByContentType); "if the new config fails for any reason, the old config is rolled back
 *     into place without downtime" (docs; caddy.go changeConfig restores the previous raw config).
 *     An identical config is a no-op without `Cache-Control: must-revalidate`.
 *   · `GET /config/` (`getConfig`) — the running config as JSON, `null` when empty (admin.go
 *     handleConfig).
 * ⛔ A FAILED LOAD CAN ANSWER 200. load.go writes the adapter's WARNINGS to the body before it
 *   runs the config; if the run then fails, the error JSON is appended to a response whose status
 *   is already 200. The Caddyfile adapter warns on every unformatted input (adapter.go
 *   FormattingDifference), so this is the COMMON failure shape, not an edge. The SDK's own
 *   `CaddyProtocol` (`packages/distilled-caddy/src/protocol.ts`) scans `loadConfig`'s body for the
 *   embedded error on every status and fails with the typed `LoadRefused` — `catchTag`'d below,
 *   never a status check here. The lifecycle also reads the config back after every load anyway
 *   (config-lifecycle.ts).
 */
import * as Effect from 'effect/Effect';
import * as Caddy from '@distilled.cloud/caddy';

const CADDYFILE = 'text/caddyfile';

type Warning = { readonly file?: string; readonly line?: number; readonly message?: string };

const describe = (warning: Warning): string =>
  `${warning.file ?? 'Caddyfile'}:${String(warning.line ?? 0)}: ${warning.message ?? '(no message)'}`;

export type Adapted = { readonly config: unknown; readonly warnings: readonly string[] };

/** Adapt a Caddyfile to JSON on the running Caddy, without loading it. */
export const adaptCaddyfile = (
  caddyfile: string,
): Effect.Effect<Adapted, Caddy.CaddyOpError, Caddy.CaddyOpContext> =>
  Effect.map(
    Caddy.Services.admin.adaptConfig({ config: caddyfile, contentType: CADDYFILE }),
    (response) => ({
      config: response.result ?? null,
      warnings: (response.warnings ?? []).map(describe),
    }),
  );

/** The running config, parsed; `null` when Caddy runs with none. */
export const readRunningConfig = (): Effect.Effect<
  unknown,
  Caddy.CaddyOpError,
  Caddy.CaddyOpContext
> => Effect.map(Caddy.Services.admin.getConfig({ path: '' }), (response) => response.value ?? null);

/**
 * Apply a Caddyfile with `POST /load`; resolves with the adapter's warnings. A refused load
 * (`LoadRefused` — the ⛔ above) propagates as that typed error, unretried by anything in this
 * file — config-lifecycle.ts's `reconcileConfig` is where a refusal turns into a message naming
 * what is still running.
 *
 * ★ `sourceFile` RIDES AS `Caddy-Config-Source-File` (+ `-Adapter: caddyfile`), the headers
 *   `caddy reload` sends (cmd/commandfuncs.go). A load WITHOUT them makes Caddy forget the file it
 *   was started with (caddy.go ClearLastConfigIfDifferent), and SIGUSR1 then no longer reloads
 *   from that file. With them, and the same path, it keeps it.
 */
export const loadCaddyfile = (
  caddyfile: string,
  sourceFile?: string,
): Effect.Effect<readonly string[], Caddy.CaddyOpError, Caddy.CaddyOpContext> =>
  Effect.map(
    Caddy.Services.admin.loadConfig({
      config: caddyfile,
      contentType: CADDYFILE,
      ...(sourceFile === undefined ? {} : { sourceAdapter: 'caddyfile', sourceFile }),
    }),
    (response) => (response.warnings ?? []).map(describe),
  );
