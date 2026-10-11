/**
 * B0a / T12 DEFENSE IN DEPTH, AT THE WIRE. `policy.ts`'s `UnifiWriteRefused` stops write INTENT at
 * `reconcile`/`destroy`; this guard stops the same thing one layer lower. It wraps whatever
 * `HttpClient` the caller already provides (the stack's `FetchHttpClient.layer` in production,
 * `fakeUnifiLayer` in tests — `openbao/bao-http.ts`'s header names this same "wrap, don't
 * replace" seam), so an SDK write operation called by mistake, bypassing `unifiOperations`, still
 * never reaches the vendor API. `write-op-reference.test.ts` proves no such call exists outside
 * `network-update.ts`; this is what stops one from ever taking effect.
 *
 * ★ A GET ALWAYS PASSES THE REQUEST GUARD; ANY OTHER METHOD PASSES ONLY WHEN `(method, pathname)`
 *   MATCHES AN ENTRY OF THE `allow` LIST. `unifiHandlers` builds that list PER ROW
 *   (`spec.update.allowedWrite(news)`): the one PUT that can pass is to this row's own
 *   `/v1/sites/<siteId>/networks/<networkId>` under the CONFIGURED base URL (local and
 *   cloud-connector base paths differ, so the base is passed in and compared exactly, `isAllowed`).
 *   A PUT to another network id, the list route, or another family dies here.
 *
 * ⚠️ `Effect.die`, NOT A TYPED FAILURE — every generated SDK operation declares its OWN closed
 *   error union from the pinned OpenAPI spec and generated files are never hand-edited, so a typed
 *   `Effect.fail` here would be a failure absent from every op's declared type. A defect is the
 *   sound way to add a "structurally impossible" failure underneath types this package does not
 *   own, like `openbao`'s `refuse()` helpers.
 *
 * ⛔ REDIRECTS (LOW-7), REFUSED FOR EVERY METHOD — GETs included, 2026-10-10. The layer sets fetch
 *   `redirect: 'manual'` on EVERY guarded request and the guard dies on any 3xx answer. Default
 *   fetch follows a redirect and re-sends the request to a `Location` this guard never saw — a PUT
 *   with its body on 307/308, a GET still carrying the API-key header — so following is never
 *   safe. Scoping `manual` to a non-empty allow list (the pre-2026-10-10 shape) also made the two
 *   postures DIVERGE by accident: reconcile's own GETs ran manual, so a 3xx surfaced raw and failed
 *   the SDK decode, while read/diff under `GetOnlyHttpClient` followed the redirect silently. One
 *   rule for both postures now: a redirect is refused everywhere, fail closed.
 */
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import type * as HttpClientResponse from 'effect/http/HttpClientResponse';
import { UNIFI_WRITE_POLICY } from './policy.ts';

/**
 * One non-GET request the guard may let through. `tail` is the exact route below the configured
 * base URL (`/v1/sites/<site>/networks/<id>`): the guard compares the request's origin and path to
 * `baseUrl + tail` and requires an empty query and fragment (`isAllowed`).
 */
export type AllowedWrite = { readonly method: 'PUT'; readonly tail: string };

export class UnifiRefusedRequest extends Error {
  constructor(
    readonly method: string,
    /** PATH ONLY, never the full URL — see `requestPath` below. */
    readonly path: string,
    detail = "not on this row's allow list",
  ) {
    super(
      `UniFi HttpClient guard: refused ${method} ${path} (${detail}) -- ${UNIFI_WRITE_POLICY}. ` +
        'This is a defect, not a recoverable condition: something under src/unifi sent a request ' +
        "policy.ts's per-operation refusal should already have made impossible. Fix the kit " +
        'code that produced this request.',
    );
    this.name = 'UnifiRefusedRequest';
  }
}

/** @deprecated renamed `UnifiRefusedRequest`; kept so existing consumer imports do not break. */
export const UnifiNonGetRequest = UnifiRefusedRequest;
export type UnifiNonGetRequest = UnifiRefusedRequest;

/**
 * ⛔ PATH ONLY, NEVER THE HOST. A cloud connector's base URL embeds the account's Console ID
 *   (`docs/unifi.md`'s Credentials section, T3) — a defect message can still reach a log or a CI
 *   failure body. Falls back to a fixed placeholder on a parse failure so a malformed URL can
 *   never leak through unredacted.
 */
const requestPath = (url: string): string => {
  try {
    // ⛔ The cloud connector path is `/v1/connector/consoles/<consoleId>/...`: the id is dropped too.
    return new URL(url).pathname.replace(/(\/consoles\/)[^/]*/g, '$1<redacted>');
  } catch {
    return '<unparseable request url>';
  }
};

/**
 * ⛔ ANCHORED TO THE CONFIGURED BASE URL, NOT A SUFFIX. The request must share the base's origin,
 *   its path must be exactly `<base path><tail>` (so `//v1/...`, another base path or a nested
 *   `/v1/sites/X/v1/sites/s/...` all miss), and it must carry no query or fragment (`?force=true`).
 *   Without a base URL nothing is allowed: fail closed.
 */
const isAllowed = (
  allow: ReadonlyArray<AllowedWrite>,
  baseUrl: string | undefined,
  method: string,
  request: HttpClientRequest.HttpClientRequest,
) => {
  if (baseUrl === undefined) return false;
  try {
    const base = new URL(baseUrl);
    // ⛔ `toUrl`, NOT `request.url`: `setUrlParam` keeps its parameters OUTSIDE `request.url`, so
    //   the bare string looked query-free while the wire request carried `?force=true` (round 2, F5).
    const resolved = HttpClientRequest.toUrl(request);
    if (Option.isNone(resolved)) return false;
    const target = resolved.value;
    if (target.origin !== base.origin || target.search !== '' || target.hash !== '') return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    return allow.some(
      (entry) => entry.method === method && target.pathname === `${basePath}${entry.tail}`,
    );
  } catch {
    return false;
  }
};

/** True when the response says it came from a different URL than the request named. */
const followedElsewhere = (res: HttpClientResponse.HttpClientResponse): boolean => {
  const sent = HttpClientRequest.toUrl(res.request);
  return res.url !== '' && Option.isSome(sent) && res.url !== sent.value.href.split('#')[0];
};

const guard = (
  client: HttpClient.HttpClient,
  allow: ReadonlyArray<AllowedWrite>,
  baseUrl: string | undefined,
) =>
  client.pipe(
    HttpClient.mapRequestEffect((request) =>
      request.method === 'GET' || isAllowed(allow, baseUrl, request.method, request)
        ? Effect.succeed(request)
        : Effect.die(new UnifiRefusedRequest(request.method, requestPath(request.url))),
    ),
    HttpClient.transformResponse((response) =>
      Effect.flatMap(response, (res) =>
        // ⛔ ANY METHOD: a GET's 3xx is refused exactly like a PUT's — see REDIRECTS in the header.
        res.status >= 300 && res.status < 400
          ? Effect.die(
              new UnifiRefusedRequest(
                res.request.method,
                requestPath(res.request.url),
                `answered a ${res.status} redirect`,
              ),
            )
          : // ⛔ BACKSTOP (round 2, F3): if a consumer's own transform replaced `manual` and fetch
            //   followed a redirect, the response URL is no longer the request's. Die on that.
            followedElsewhere(res)
            ? Effect.die(
                new UnifiRefusedRequest(
                  res.request.method,
                  requestPath(res.request.url),
                  'the response URL differs from the request URL (a redirect was followed)',
                ),
              )
            : Effect.succeed(res),
      ),
    ),
  );

/**
 * A `Layer` that reads whatever `HttpClient` is already in the calling context and replaces it,
 * for everything downstream, with the guarded version. Exported so `wire-guard.test.ts` can prove
 * the mechanism against a bare `HttpClient`, without `CredentialsFromEnv` or any env var.
 */
export const guardedHttpClient = (allow: ReadonlyArray<AllowedWrite>, baseUrl?: string) => {
  return HttpClient.layerMergedContext(
    Effect.map(HttpClient.HttpClient, (client) =>
      // ⛔ MANUAL REDIRECT ON BOTH POSTURES, not just an allow list: the response guard refuses a
      //   3xx for GETs too, and under the default 'follow' a GET redirect is silently followed —
      //   the guard would never see it, and read/diff would diverge from reconcile again.
      HttpClient.transform(guard(client, allow, baseUrl), manualRedirect),
    ),
  );
};

/**
 * ⛔ `redirect: 'manual'` IS SET PER REQUEST, ON THE CALLING FIBER'S `RequestInit`. A layer-provided
 *   `RequestInit` is silently REPLACED by an outer one (Effect 4.0.1 `layerMergedContext` merges the
 *   caller's context over the layer's), which would turn redirects back on. Same read-merge-provide
 *   pattern as `openbao/bao-http.ts`'s `overSocket`; outer fetch options are kept.
 */
const manualRedirect = <E, R>(
  effect: Effect.Effect<HttpClientResponse.HttpClientResponse, E, R>,
): Effect.Effect<HttpClientResponse.HttpClientResponse, E, R> =>
  Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (existing) =>
    Effect.provideService(effect, FetchHttpClient.RequestInit, {
      ...Option.getOrElse(existing, () => ({})),
      redirect: 'manual',
    }),
  );

/**
 * No write may pass; the posture of `read`/`diff`/`delete` and of every non-updatable family. A 3xx
 * answer to a GET is refused here exactly as under the allow-list posture — see REDIRECTS above.
 */
export const GetOnlyHttpClient = guardedHttpClient([]);
