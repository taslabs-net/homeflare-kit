/**
 * Refuse a config whose `admin` block would cut the provider off from Caddy, or expose the admin
 * API — checked on the ADAPTED JSON (`POST /adapt`), before anything is loaded.
 *
 * ⛔ A Caddyfile can move its own admin endpoint. After `POST /load`, Caddy swaps the admin server
 *   to the new config's (admin.go replaceLocalAdminServer), so each of these would succeed ONCE and
 *   then strand the resource — no read-back, no drift check, no next deploy — or worse:
 *   · `admin off` (`disabled`): nothing can manage this Caddy through its API again.
 *   · a `listen` off loopback (`:2019`, `0.0.0.0:2019`, a LAN address): the unauthenticated API is
 *     on the network. Decision 23: never expose :2019.
 *   · a `listen` on another port, socket or loopback ADDRESS than the transport's: the provider
 *     loses Caddy. Go binds exactly the literal address given (`[::1]:2019` is not reachable at
 *     `127.0.0.1:2019`), and a hostname binds its first IPv4 address (net ListenConfig.Listen,
 *     `addrs.first(isIPv4)`), so `localhost:2019` is `127.0.0.1:2019`. MEASURED 2026-09-21 on a
 *     throwaway Caddy 2.11.4: after loading `admin [::1]:<p>`, `127.0.0.1:<p>` refused the
 *     connection; after `admin localhost:<p>`, `[::1]:<p>` did.
 *   · NO `admin` address at all: Caddy falls back to DefaultAdminListen — `localhost:2019`, or
 *     `$CADDY_ADMIN` in ITS environment (admin.go replaceLocalAdminServer), which this side cannot
 *     see. A Caddy reached any other way (a socket, another port) moves there on the first load.
 *     Refused unless the transport is at that default; declaring `admin <address>` is the fix.
 *   · a Host the new config does not allow: `origins` without it, or — with no `origins` — a Host
 *     outside Caddy's loopback defaults (`localhost`, `[::1]`, `127.0.0.1` at the listen port).
 *     Every later call answers 403 (admin.go allowedOrigins / checkHost; MEASURED on the mini's
 *     Caddy 2.11.4 — `host not allowed`). The transport also sends `Origin: http://<Host>`, which
 *     Caddy checks against the same list (originAllowed), so one check covers both.
 *   · `enforce_origin` over a unix socket: this transport, like Caddy's CLI (cmd/commandfuncs.go
 *     AdminAPIRequest), sends no Origin there, and a unix listener has no default origins — so
 *     checkOrigin answers 403 to every call. MEASURED 2026-09-21 on a throwaway Caddy 2.11.4:
 *     `client is not allowed to access from origin ''`, and that Caddy could not be managed again.
 *   · `remote`: a second, network-facing admin listener (mTLS on :2021) — declare that deliberately,
 *     not through this resource.
 *   · `config.load`: Caddy pulls its config from elsewhere, replacing this one on a timer.
 * ★ Read in caddyserver/caddy v2.11.4: admin.go AdminConfig / allowedOrigins / originAllowed, and
 *   httpcaddyfile/options.go parseOptAdmin (an `admin { … }` block with no address still emits
 *   `listen` as the default, so a present `listen` is the norm, not a change).
 */
import type { CaddyAdminListener } from './admin.ts';

type AdminBlock = {
  disabled?: boolean;
  listen?: string;
  origins?: string[];
  enforce_origin?: boolean;
  remote?: unknown;
  config?: { load?: unknown };
};

/** Caddy's compiled-in admin port (admin.go DefaultAdminListen `localhost:2019`). */
const DEFAULT_ADMIN_PORT = 2019;

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/;

type Listen = { kind: 'tcp'; host: string; port: number } | { kind: 'unix'; path: string };

/** Caddy network address → a listener, or a description of why it is not one we can check. */
const parseListen = (listen: string): Listen | string => {
  if (listen.includes('{')) return 'a placeholder, which cannot be checked before it runs';
  const unix = /^unix(?:gram|packet)?\/(.+?)(?:\|[0-7]{3,4})?$/.exec(listen);
  if (unix !== null) return { kind: 'unix', path: unix[1] ?? '' };
  if (/^[a-z0-9]+\//.test(listen) && !/^tcp[46]?\//.test(listen)) {
    return `network ${JSON.stringify(listen.split('/')[0])}, not tcp or unix`;
  }
  const address = listen.replace(/^tcp[46]?\//, '');
  const colon = address.lastIndexOf(':');
  const port = Number(address.slice(colon + 1));
  if (colon === -1 || !Number.isInteger(port) || port <= 0) return 'no single port';
  return { host: address.slice(0, colon), kind: 'tcp', port };
};

const unbracket = (host: string): string => host.replace(/^\[(.*)\]$/, '$1');

/**
 * Whether a transport sending `hostHeader` reaches a listener bound to `listenHost`.
 * ★ The Host stands in for the dial address: they are the same unless `hostHeader` was set for a
 *   forward, where it should name the far side's address anyway. `localhost` on the transport's
 *   side may resolve to either family (node tries both), so it reaches any loopback listener; a
 *   literal address reaches only itself.
 */
const reaches = (hostHeader: string, listenHost: string): boolean => {
  const dialled = unbracket(hostHeader.slice(0, hostHeader.lastIndexOf(':')));
  const listening = unbracket(listenHost);
  return (
    dialled === 'localhost' || dialled === (listening === 'localhost' ? '127.0.0.1' : listening)
  );
};

const sameListener = (listen: Listen, transport: CaddyAdminListener): boolean =>
  listen.kind === 'tcp'
    ? transport.kind === 'tcp' &&
      listen.port === transport.port &&
      reaches(transport.hostHeader, listen.host)
    : transport.kind === 'unix' && listen.path === transport.path;

/** Caddy's allowed Hosts for a loopback listener with no `origins` (admin.go allowedOrigins). */
const defaultOrigins = (port: number): string[] =>
  ['localhost', '[::1]', '127.0.0.1'].map((host) => `${host}:${String(port)}`);

const originHost = (origin: string): string | undefined => {
  if (!origin.includes('://')) return origin;
  try {
    const url = new URL(origin);
    // ⚠️ originAllowed compares schemes when an entry has one; the transport sends `http://`.
    return url.protocol === 'http:' ? url.host : undefined;
  } catch {
    return undefined;
  }
};

const listenProblem = (admin: AdminBlock, transport: CaddyAdminListener): string | undefined => {
  if (admin.listen === undefined) {
    const atDefault =
      transport.kind === 'tcp' &&
      transport.port === DEFAULT_ADMIN_PORT &&
      reaches(transport.hostHeader, 'localhost');
    return atDefault
      ? undefined
      : 'no `admin` address: Caddy would fall back to its default listener (localhost:2019, or ' +
          '$CADDY_ADMIN), away from where this provider reaches it — declare `admin <address>`';
  }
  const listen = parseListen(admin.listen);
  const shown = JSON.stringify(admin.listen);
  if (typeof listen === 'string') {
    return `admin listen ${shown} is ${listen}; declare a literal loopback address`;
  }
  if (listen.kind === 'tcp' && !LOOPBACK_HOST.test(listen.host)) {
    return `admin listen ${shown} is not loopback — it would put the admin API on the network`;
  }
  return sameListener(listen, transport)
    ? undefined
    : `admin listen ${shown} moves the admin API away from where this provider reaches it`;
};

/** Refusals for the adapted config's `admin` block, given where the transport reaches Caddy. */
export const adminProblems = (adapted: unknown, transport: CaddyAdminListener): string[] => {
  const admin =
    typeof adapted === 'object' && adapted !== null
      ? ((adapted as { admin?: AdminBlock }).admin ?? {})
      : {};
  const found: string[] = [];
  if (admin.disabled === true) {
    return ['`admin off` would disable the admin API this resource manages Caddy through'];
  }
  if (admin.remote !== undefined) found.push('`admin.remote` opens a network-facing admin API');
  if (admin.config?.load !== undefined) {
    found.push(
      '`admin.config.load` makes Caddy pull its config from elsewhere, replacing this one',
    );
  }
  const moved = listenProblem(admin, transport);
  if (moved !== undefined) found.push(moved);
  if (transport.kind === 'tcp') {
    const allowed = admin.origins?.map(originHost) ?? defaultOrigins(transport.port);
    if (!allowed.includes(transport.hostHeader)) {
      const which =
        admin.origins === undefined
          ? `Caddy's default origins (no \`origins\` declared) ${JSON.stringify(allowed)}`
          : `admin origins ${JSON.stringify(admin.origins)}`;
      found.push(
        `${which} do not allow Host ${transport.hostHeader}, which this provider sends — ` +
          'Caddy would refuse it every call after this one',
      );
    }
  } else if (admin.enforce_origin === true) {
    found.push(
      '`enforce_origin` over a unix socket: this transport (like the Caddy CLI) sends no Origin ' +
        'there, so Caddy would answer 403 to every call',
    );
  }
  return found;
};
