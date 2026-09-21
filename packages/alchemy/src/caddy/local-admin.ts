/**
 * The real CaddyAdmin: this machine's Caddy, over loopback TCP or a unix socket.
 *
 * ★ node:http, NOT fetch. MEASURED 2026-09-21 on bun 1.4.0 and node 26.7.0: node:http sends a Host
 *   override and dials a unix socket on BOTH runtimes, while node's fetch silently drops a `Host`
 *   header (it sent the URL's host) and only Bun's fetch has a `unix` option. The published dist
 *   loads under node too (launchd's local-runner.ts makes the same call for the same reason).
 * ⛔ LOOPBACK OR A UNIX SOCKET, NOTHING ELSE. The admin API is unauthenticated plaintext; an
 *   address off this machine means it is reachable from the network, which decision 23 forbids.
 *   Reaching another host's Caddy means forwarding its socket or port to here (SSH), never
 *   exposing :2019.
 * ★ HOST AND ORIGIN, AS CADDY's OWN CLI SENDS THEM (cmd/commandfuncs.go AdminAPIRequest): over
 *   TCP, `Host` and `Origin: http://<host>`; over a socket, `Host: 127.0.0.1` and no Origin, because
 *   Caddy skips the Host check on unix listeners (admin.go allowedOrigins). MEASURED against the
 *   mini's Caddy 2.11.4: any other Host gets 403 `host not allowed`, a forwarded port included —
 *   hence `hostHeader`.
 */
import { request as httpRequest } from 'node:http';
import {
  type CaddyAdmin,
  type CaddyAdminListener,
  type CaddyAdminResponse,
  CaddyUnreachableError,
} from './admin.ts';

export type LocalCaddyAdminOptions = {
  /**
   * `http://<loopback>:<port>` or `unix:///absolute/path.sock`.
   * @default 'http://127.0.0.1:2019' — Caddy's default admin listener (`localhost:2019`).
   */
  readonly address?: string;
  /**
   * The Host (and Origin) to send over TCP, when it is not the address's own: the Caddyfile
   * narrowed `admin { origins … }`, or the port is an SSH forward of the real one (Caddy checks
   * the Host against ITS port, not yours). Form `host:port`.
   */
  readonly hostHeader?: string;
  /**
   * Abort an exchange after this long. @default 60_000
   * ⚠️ A `shutdown_delay` in the Caddyfile makes `/load` block that long (caddyhttp app.go Stop);
   *   a timeout then fails the deploy while Caddy goes on to apply — the next plan converges.
   */
  readonly timeoutMs?: number;
  /**
   * Retries when the connection is REFUSED (nothing listening yet — a Caddy launchd job that was
   * bootstrapped a moment ago). Only refusals: those never reached Caddy, so re-sending a
   * `POST /load` cannot apply it twice. @default 2
   */
  readonly retries?: number;
  /** @default 500 */
  readonly retryDelayMs?: number;
};

export const DEFAULT_ADMIN_ADDRESS = 'http://127.0.0.1:2019';

type Target =
  | { readonly kind: 'tcp'; readonly host: string; readonly port: number }
  | { readonly kind: 'unix'; readonly socketPath: string };

const UNIX = 'unix://';
const HOST_PORT = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):\d{1,5}$/;

const refuse = (address: string, why: string): Error =>
  new Error(`Caddy admin address ${JSON.stringify(address)}: ${why}`);

const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

/** The dial target and listener for an address, or a refusal naming what is wrong with it. */
export const parseAdminAddress = (
  address: string,
  hostHeader?: string,
): { target: Target; listener: CaddyAdminListener } => {
  if (hostHeader !== undefined && !HOST_PORT.test(hostHeader)) {
    throw refuse(address, `hostHeader ${JSON.stringify(hostHeader)} must be host:port`);
  }
  if (address.startsWith(UNIX)) {
    const socketPath = address.slice(UNIX.length);
    if (!socketPath.startsWith('/')) throw refuse(address, 'the socket path must be absolute');
    return { listener: { kind: 'unix', path: socketPath }, target: { kind: 'unix', socketPath } };
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw refuse(address, 'not a URL (http://127.0.0.1:2019 or unix:///path)');
  }
  // ⛔ Caddy's local admin endpoint is plaintext by design; its TLS one (`admin.remote`, mTLS on
  //   :2021) is a different, network-facing API this transport deliberately does not speak.
  if (url.protocol !== 'http:') throw refuse(address, 'only http:// (loopback) or unix://');
  if (!isLoopback(url.hostname)) {
    throw refuse(address, 'not loopback — the admin API is unauthenticated; forward it to here');
  }
  if (url.pathname !== '/' || url.search !== '' || url.username !== '') {
    throw refuse(address, 'no path, query or credentials — the API lives at the root');
  }
  const port = url.port === '' ? 80 : Number(url.port);
  // ⚠️ NOT `url.host`: WHATWG URL drops a default port (`http://127.0.0.1:80` has host
  //   `127.0.0.1`), and Caddy compares the Host against `host:port` (admin.go allowedOrigins), so
  //   a portless Host is a 403 on every call. The Caddy CLI always sends the port (JoinHostPort).
  const host = hostHeader ?? `${url.hostname}:${String(port)}`;
  return {
    listener: {
      hostHeader: host,
      kind: 'tcp',
      port: Number(host.slice(host.lastIndexOf(':') + 1)),
    },
    // ★ `hostname` keeps IPv6 brackets; node:http wants them off.
    target: { host: url.hostname.replace(/^\[(.*)\]$/, '$1'), kind: 'tcp', port },
  };
};

const code = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

/** Nothing accepted the connection: refused TCP, or no socket file yet. The request never left. */
const neverConnected = (cause: unknown): boolean =>
  code(cause) === 'ECONNREFUSED' || code(cause) === 'ENOENT';

const exchange = (
  target: Target,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<CaddyAdminResponse> =>
  new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(body, 'utf8');
    const request = httpRequest(
      {
        ...(target.kind === 'tcp'
          ? { host: target.host, port: target.port }
          : { socketPath: target.socketPath }),
        headers: bytes === undefined ? headers : { ...headers, 'Content-Length': bytes.length },
        method,
        path,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.on('timeout', () => request.destroy(new Error(`no answer in ${String(timeoutMs)} ms`)));
    request.on('error', reject);
    request.end(bytes);
  });

export const localCaddyAdmin = (options: LocalCaddyAdminOptions = {}): CaddyAdmin => {
  const address = options.address ?? DEFAULT_ADMIN_ADDRESS;
  const { listener, target } = parseAdminAddress(address, options.hostHeader);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retries = options.retries ?? 2;
  const delay = options.retryDelayMs ?? 500;
  const fixed: Record<string, string> =
    listener.kind === 'tcp'
      ? { Host: listener.hostHeader, Origin: `http://${listener.hostHeader}` }
      : { Host: '127.0.0.1' };
  return {
    endpoint: address,
    listener,
    request: async ({ body, headers, method, path }) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- sequential by design: retry after a wait
          return await exchange(target, method, path, { ...headers, ...fixed }, body, timeoutMs);
        } catch (cause) {
          if (!neverConnected(cause) || attempt >= retries) {
            const reason = cause instanceof Error ? cause.message : String(cause);
            const message = `Caddy admin ${method} ${path} at ${address}: ${reason}`;
            throw neverConnected(cause) ? new CaddyUnreachableError(message) : new Error(message);
          }
          // oxlint-disable-next-line no-await-in-loop -- the wait between attempts
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    },
  };
};
