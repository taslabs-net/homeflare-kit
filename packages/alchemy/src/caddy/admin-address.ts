/**
 * Parses a `localCaddyAdmin()` address into a dial target and the listener Caddy checks requests
 * against — pure, so admin-guard.ts and local-admin.ts's tests exercise it with no transport at all.
 *
 * ★ LOOPBACK OR A UNIX SOCKET, NOTHING ELSE. The admin API is unauthenticated plaintext; an address
 *   off this machine means it is reachable from the network, which decision 23 forbids. Reaching
 *   another host's Caddy means forwarding its socket or port to here (SSH), never exposing :2019.
 * ★ HOST, AS CADDY's OWN CLI SENDS IT (cmd/commandfuncs.go AdminAPIRequest): `host:port`, over TCP.
 *   MEASURED against a Mac host's Caddy 2.11.4: any other Host gets 403 `host not allowed`, a
 *   forwarded port included — hence `hostHeader`.
 */
import type { CaddyAdminListener } from './admin.ts';

export type Target =
  | { readonly kind: 'tcp'; readonly host: string; readonly port: number }
  | { readonly kind: 'unix'; readonly socketPath: string };

export const DEFAULT_ADMIN_ADDRESS = 'http://127.0.0.1:2019';

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
