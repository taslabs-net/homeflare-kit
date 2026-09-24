/**
 * The real Caddy transport: this machine's Caddy, over loopback TCP or a unix socket — the
 * `Credentials` and `HttpClient.HttpClient` layers `@distilled.cloud/caddy`'s typed operations run
 * against (admin-calls.ts), plus the message/guard metadata `CaddyAdminService` carries.
 *
 * Address parsing (`parseAdminAddress`) is pure — admin-address.ts. The wire transport itself
 * (retries, timeouts, the unix-socket dial) is caddy-http-client.ts; this file is the seam between
 * the two and `@distilled.cloud/caddy`'s own `Credentials`.
 */
import * as Layer from 'effect/Layer';
import * as Caddy from '@distilled.cloud/caddy';
import type { CaddyTransport } from './admin.ts';
import { DEFAULT_ADMIN_ADDRESS, parseAdminAddress } from './admin-address.ts';
import { type LocalHttpClientOptions, makeLocalHttpClient } from './caddy-http-client.ts';

export { DEFAULT_ADMIN_ADDRESS, parseAdminAddress } from './admin-address.ts';
export { isUnreachable } from './caddy-http-client.ts';

export type LocalCaddyAdminOptions = LocalHttpClientOptions & {
  /**
   * `http://<loopback>:<port>` or `unix:///absolute/path.sock`.
   * @default 'http://127.0.0.1:2019' — Caddy's default admin listener (`localhost:2019`).
   */
  readonly address?: string;
  /**
   * The Host (and, over TCP, Origin) to send when it is not the address's own: the Caddyfile
   * narrowed `admin { origins … }`, or the port is an SSH forward of the real one (Caddy checks
   * the Host against ITS port, not yours). Form `host:port`. Over a unix socket this still sets
   * the Host header `@distilled.cloud/caddy`'s protocol always sends (Caddy skips the Host check
   * on unix listeners regardless — admin.go allowedOrigins) — defaults to `127.0.0.1`, matching
   * the Caddy CLI's own unix-socket calls (cmd/commandfuncs.go AdminAPIRequest).
   */
  readonly hostHeader?: string;
};

/**
 * A transport to this machine's Caddy — feed it to `caddyProviders()`, or build the layer by hand
 * with `CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(localCaddyAdmin())))` (never
 * plain `Layer.provide` — admin.ts's own doc on `caddyAdminLayer` says why).
 *
 * ⛔ LOOPBACK OR A UNIX SOCKET, NOTHING ELSE. The admin API is unauthenticated plaintext; an
 *   address off this machine means it is reachable from the network, which decision 23 forbids.
 *   `parseAdminAddress` refuses anything else.
 */
export const localCaddyAdmin = (options: LocalCaddyAdminOptions = {}): CaddyTransport => {
  const address = options.address ?? DEFAULT_ADMIN_ADDRESS;
  const { listener, target } = parseAdminAddress(address, options.hostHeader);
  // `@distilled.cloud/caddy`'s protocol always builds `Host`/Origin from `apiBaseUrl` (or this
  // override) — never from the dial target, which caddy-http-client.ts ignores the URL's host/port
  // for anyway over a unix socket. `http://localhost` is a placeholder base for the request-URL
  // machinery (`buildRequest` needs a syntactically valid `http://` URL to join `/config/…` onto);
  // the hostHeader default `127.0.0.1` is what actually reaches Caddy's Host check, matching what
  // the Caddy CLI sends over a unix socket.
  const credentials =
    target.kind === 'unix'
      ? Caddy.fromApiBaseUrl({
          apiBaseUrl: 'http://localhost',
          hostHeader: options.hostHeader ?? '127.0.0.1',
        })
      : Caddy.fromApiBaseUrl({
          apiBaseUrl: address,
          ...(options.hostHeader === undefined ? {} : { hostHeader: options.hostHeader }),
        });
  return {
    endpoint: address,
    // ⚠️ `Caddy.Retry.Retry` DISABLED, not left at the SDK's default. MEASURED 2026-09-23: core's
    //   `isTransientError` treats ANY `HttpClientError` with a `TransportError` reason as transient
    //   — including an ECONNRESET well after the connection was accepted — and every generated
    //   operation already retries under that default (`API.make({ retry: Retry.Retry })`,
    //   services/admin.ts). Left in place, it retried a `POST /load` that had already reached the
    //   far side (a socket that accepted, then reset) — the exact re-send admin-calls.ts's module
    //   doc says must never happen — NINE times over, compounding with caddy-http-client.ts's own
    //   narrower retry below it. This transport's retry (ECONNREFUSED/ENOENT only — "nothing
    //   accepted the connection yet") is the one retry policy Caddy's admin API gets.
    layer: Layer.mergeAll(
      credentials,
      makeLocalHttpClient(target, options),
      Layer.succeed(Caddy.Retry.Retry, { while: () => false }),
    ),
    listener,
  };
};
