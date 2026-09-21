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
 *   · a `listen` on another port or socket than the transport's: the provider loses Caddy.
 *   · `origins` without the Host the transport sends: every later call answers 403 (admin.go
 *     checkHost; MEASURED on the mini's Caddy 2.11.4 — `host not allowed`).
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
  remote?: unknown;
  config?: { load?: unknown };
};

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/;

/** Caddy network address → a listener, or a description of why it is not one we can check. */
const parseListen = (
  listen: string,
): { kind: 'tcp'; host: string; port: number } | { kind: 'unix'; path: string } | string => {
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
  if (admin.listen !== undefined) {
    const listen = parseListen(admin.listen);
    const shown = JSON.stringify(admin.listen);
    if (typeof listen === 'string') {
      found.push(`admin listen ${shown} is ${listen}; declare a literal loopback address`);
    } else if (listen.kind === 'tcp' && !LOOPBACK_HOST.test(listen.host)) {
      found.push(
        `admin listen ${shown} is not loopback — it would put the admin API on the network`,
      );
    } else if (
      listen.kind !== transport.kind ||
      (listen.kind === 'tcp' && transport.kind === 'tcp' && listen.port !== transport.port) ||
      (listen.kind === 'unix' && transport.kind === 'unix' && listen.path !== transport.path)
    ) {
      found.push(
        `admin listen ${shown} moves the admin API away from where this provider reaches it`,
      );
    }
  }
  if (admin.origins !== undefined && transport.kind === 'tcp') {
    const allowed = admin.origins.map(originHost);
    if (!allowed.includes(transport.hostHeader)) {
      found.push(
        `admin origins ${JSON.stringify(admin.origins)} do not allow Host ${transport.hostHeader}, ` +
          'which this provider sends — Caddy would refuse it every call after this one',
      );
    }
  }
  return found;
};
