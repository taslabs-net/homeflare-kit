/**
 * A gateway transport for the official TypeSafe SDK: reaches Cloudflare's AI Gateway
 * catalog route through `TypeSafeClientConfig.fetch` — "custom HTTP fetch
 * implementation for transport configuration or tests" per the SDK's own types
 * (measured 2026-09-23 in node_modules/@typesafe-ai/sdk@0.6.0/dist/index.d.mts) —
 * instead of building a direct `api.typesafe.ai` client with a raw key. The estate
 * holds TypeSafe's key only as BYOK in its AI Gateway (id passed at call time — see
 * `TypeSafeGatewayOptions.gatewayId` below; this public package names no estate
 * identifier); this is the seam that lets an official client reach it without
 * becoming a second client.
 *
 * ⛔ STILL NOT A REPLACEMENT CLIENT. `systemOne()`, retries, parsing and error classes
 *   all stay the official SDK's (see ../src/index.ts); this only swaps where the bytes
 *   go. The request/response mapping itself lives in ./gateway-map.ts.
 *
 * ★ WHY NO FRESH LIVE PROBE OF THE ROUTE ITSELF. The route, exact header set, response
 *   envelope, keySource, and model-pinning behaviour this file implements were already
 *   measured live on 2026-09-23 and published in
 *   plugins/homeflare-workflows/skills/typesafe-ai/references/ai-gateway.md — part of
 *   the released homeflare-workflows plugin, present on origin/main today. Re-running
 *   scripts/probe-gateway.ts here would repeat that exact BYOK-billed call for no new
 *   information, against a real credential, purely to duplicate a record that already
 *   exists — so it was not run. gateway-map.ts's catalog input/output JSON Schemas
 *   were still re-fetched live for this change, since that read needs no credential and
 *   directly gates the request-shape logic below.
 *
 * ★ `cf-aig-collect-log` WAS PROBED (scripts/probe-collect-log.ts, 2026-09-23) —
 *   EFFECTIVE: the live gateway had `collect_logs: true` and 50 entries already logged
 *   in the previous 24h (control), and one real call sent with the default (unset)
 *   `collectLog` produced zero entries at or after the call — checked three times over
 *   ~40s — and no `cf-aig-log-id` response header. Full output in the PR that added
 *   this option.
 */
import { type Fetch, TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import {
  GATEWAY_SENTINEL_API_KEY,
  GATEWAY_SENTINEL_BASE_URL,
  mapRequest,
  mapResponse,
} from './gateway-map.ts';
export { GATEWAY_MODEL_HEADER, type ModelMismatch, modelMismatchOf } from './gateway-model.ts';

/** Options for {@link createTypeSafeGatewayClient}. Omits what the gateway itself owns. */
export type TypeSafeGatewayOptions = Omit<TypeSafeClientConfig, 'apiKey' | 'baseURL' | 'fetch'> & {
  /** Cloudflare account id that owns the AI Gateway. */
  readonly accountId: string;
  /** Token scoped to Workers AI Read + AI Gateway Run. Held only in this closure —
   *  never becomes the SDK's `apiKey`, which its debug logger partially prints. */
  readonly token: string;
  /** The gateway's id (e.g. `example-gateway` in this package's own fixtures —
   *  never an estate value here; this package is published publicly). Without it
   *  Cloudflare routes through the account's default gateway, which holds no BYOK
   *  key. */
  readonly gatewayId: string;
  /** Cloudflare model-catalog id. Default: `typesafe/jev`. */
  readonly catalogModel?: string;
  /** Sends `cf-aig-collect-log: true`, so the gateway keeps a log entry for this
   *  request. Default `false`: the gateway keeps no log entry — see
   *  developers.cloudflare.com/ai-gateway/observability/logging (read 2026-09-23,
   *  "If cf-aig-collect-log is false, the entire log entry is skipped"). Cannot be
   *  overridden by `defaultHeaders` or a per-call `headers` option: the adapter builds
   *  this header itself and never reads headers the SDK computed (see gateway-map.ts's
   *  `mapRequest`, which never touches `init.headers`). */
  readonly collectLog?: boolean;
  /** Wraps the real network call — swap in a test double. Default: `globalThis.fetch`. */
  readonly fetch?: Fetch;
};

/**
 * Construct an official `TypeSafeClient` whose transport is Cloudflare's AI Gateway
 * catalog route instead of `api.typesafe.ai`. See the file header for what is, and is
 * not, forwarded, and gateway-map.ts for the exact request/response mapping.
 */
export function createTypeSafeGatewayClient(options: TypeSafeGatewayOptions): TypeSafeClient {
  const {
    accountId,
    token,
    gatewayId,
    catalogModel = 'typesafe/jev',
    collectLog = false,
    fetch: inner = globalThis.fetch,
    ...rest
  } = options;
  if (!accountId || !token || !gatewayId) {
    throw new RangeError('createTypeSafeGatewayClient requires accountId, token and gatewayId');
  }

  const route = { accountId, token, gatewayId, catalogModel, collectLog };

  const adapter: Fetch = async (input, init) => {
    const mapped = mapRequest(input, init, route);
    if ('refusal' in mapped) return mapped.refusal;

    const cfResponse = await inner(mapped.request.url, {
      ...mapped.request.init,
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    return mapResponse(cfResponse, mapped.requestedModel);
  };

  return new TypeSafeClient({
    ...rest,
    apiKey: GATEWAY_SENTINEL_API_KEY,
    baseURL: GATEWAY_SENTINEL_BASE_URL,
    fetch: adapter,
  });
}
