/**
 * B0a / T12 DEFENSE IN DEPTH, AT THE WIRE. `policy.ts`'s `UnifiWriteRefused` stops write INTENT at
 * `reconcile`/`destroy`; this guard stops the same thing one layer lower. It wraps whatever
 * `HttpClient` the caller already provides (the stack's `FetchHttpClient.layer` in production,
 * `fakeUnifiLayer` in tests — `openbao/bao-http.ts`'s header names this same "wrap, don't
 * replace" seam), so an SDK write operation called by mistake, bypassing `unifiOperations`, still
 * never reaches the vendor API. `write-op-reference.test.ts` proves no such call exists outside
 * `network-update.ts`; this is what stops one from ever taking effect.
 *
 * ★ GET ALWAYS PASSES; ANY OTHER METHOD PASSES ONLY WHEN `(method, pathname)` MATCHES AN ENTRY OF
 *   THE `allow` LIST. `unifiHandlers` builds that list PER ROW (`spec.update.allowedWrite(news)`):
 *   the one PUT that can pass is to this row's own `/v1/sites/<siteId>/networks/<networkId>`. A PUT
 *   to another network id, the list route, or another family dies here. The match is a suffix
 *   match because the local and cloud-connector base paths differ.
 *
 * ⚠️ `Effect.die`, NOT A TYPED FAILURE — every generated SDK operation declares its OWN closed
 *   error union from the pinned OpenAPI spec and generated files are never hand-edited, so a typed
 *   `Effect.fail` here would be a failure absent from every op's declared type. A defect is the
 *   sound way to add a "structurally impossible" failure underneath types this package does not
 *   own, like `openbao`'s `refuse()` helpers.
 *
 * ⛔ REDIRECTS (LOW-7). With a non-empty `allow` list the layer sets fetch `redirect: 'manual'` and
 *   dies on any 3xx answer to a non-GET. Default fetch re-sends a PUT body on 307/308 to a
 *   `Location` this request guard never saw — an allowed PUT could be carried to an arbitrary URL.
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpClient from 'effect/http/HttpClient';
import { UNIFI_WRITE_POLICY } from './policy.ts';

/** One non-GET request the guard may let through. */
export type AllowedWrite = { readonly method: 'PUT'; readonly path: RegExp };

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
    return new URL(url).pathname;
  } catch {
    return '<unparseable request url>';
  }
};

const isAllowed = (allow: ReadonlyArray<AllowedWrite>, method: string, path: string) =>
  allow.some((entry) => entry.method === method && entry.path.test(path));

const guard = (allow: ReadonlyArray<AllowedWrite>) => (client: HttpClient.HttpClient) =>
  client.pipe(
    HttpClient.mapRequestEffect((request) =>
      request.method === 'GET' || isAllowed(allow, request.method, requestPath(request.url))
        ? Effect.succeed(request)
        : Effect.die(new UnifiRefusedRequest(request.method, requestPath(request.url))),
    ),
    HttpClient.transformResponse((response) =>
      Effect.flatMap(response, (res) =>
        res.request.method !== 'GET' && res.status >= 300 && res.status < 400
          ? Effect.die(
              new UnifiRefusedRequest(
                res.request.method,
                requestPath(res.request.url),
                `answered a ${res.status} redirect`,
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
export const guardedHttpClient = (allow: ReadonlyArray<AllowedWrite>) => {
  const layer = HttpClient.layerMergedContext(Effect.map(HttpClient.HttpClient, guard(allow)));
  return allow.length === 0
    ? layer
    : layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ redirect: 'manual' })));
};

/** No write may pass; the posture of `read`/`diff`/`delete` and of every non-updatable family. */
export const GetOnlyHttpClient = guardedHttpClient([]);
