/**
 * The Access application calls a SaaS OIDC application needs, and nothing else.
 *
 * ★ OVER `@distilled.cloud/cloudflare` FOR EVERY WRITE AND FOR THE NAME LOOKUP; ONE RAW READ. Alchemy
 *   `2.0.0-beta.81`'s `Cloudflare.Access.Application` has no `saas_app` at all (Application.ts:
 *   `saas` appears only as an app type and in two doc comments), so this resource exists. The SDK
 *   does carry `saasApp` on the REQUEST (`AccessApplicationsCreateRequestSaasAppOIDCSaaSApp`,
 *   zero_trust.ts, `@distilled.cloud/cloudflare@1.0.0-rc.13`), so create and update go through it.
 * ⚠️ BUT ITS RESPONSES DROP IT. Measured 2026-10-09 against rc.13 with a fake API that answered a
 *   full `saas_app` object: `getAccessApplicationForAccount` and `createAccessApplicationForAccount`
 *   both decoded to `{ domain, type, id, aud, name, policies }`, with no `saasApp`. The response
 *   union is discriminated by field names (`T.UnionCases`) and a saas app falls in a variant with
 *   no `saas_app`. So the OIDC client id, redirect URIs, scopes and grant types can only be read
 *   from the wire JSON, and `getApp` below does that through the `HttpClient` the SDK itself runs
 *   on, with the SDK's own credentials and base URL. It invents no path: it is the same
 *   `GET /accounts/{account_id}/access/apps/{app_id}` the SDK's get verb sends.
 *
 * ⛔ THE CLIENT SECRET NEVER REACHES THIS PACKAGE'S MEMORY. The field doc on the SDK schema says
 *   "The application client secret, only returned on POST request". The create response is
 *   decoded by the SDK, whose `saasApp`-less variant drops it, and `getApp` copies named fields
 *   only and never reads `client_secret`. TWO paths remain where the SDK itself holds or prints the
 *   raw body (`@distilled.cloud/cloudflare@1.0.0-rc.13`, protocol.ts):
 *   1. `DISTILLED_DEBUG_HTTP` makes it `console.error` the first 400 characters of every response
 *      (line 334), so `refuseDebugHttp` stops a write while it is set. THIS ONE STAYS AN
 *      OPERATOR-ONLY SWITCH: the package can refuse to run, it cannot stop the SDK printing.
 *   2. A response that fails schema validation becomes `CloudflareParseError({ body, cause })`
 *      (lines 452-457), whose `body` is the whole parsed response, create response included.
 *      ⛔ SANITISED HERE: every SDK call of this resource (create, update, list, delete, and the
 *      organization read in saas-oidc-team.ts) catches that tag at the call and fails with a
 *      `SaasOidcError` that names the operation and nothing from the response. Why, when it can
 *      happen at all, and what rc.13 will and will not raise: saas-oidc-error.ts (`withheld`).
 *      The raw `get` below is not an SDK call and never builds that error.
 *   A PUBLIC PKCE client (`allowPkceWithoutClientSecret: true`) has no secret at all, so neither
 *   path exposes one for the Headlamp app.
 */
import { Credentials, formatHeaders } from '@distilled.cloud/cloudflare/Credentials';
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import * as Stream from 'effect/Stream';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { SaasOidcError, withheld } from './saas-oidc-error.ts';
import { type AppWrite, parseApp, record } from './saas-oidc-wire.ts';

/**
 * The two SDK writes, as properties of an object so saas-oidc-parse-error.test.ts can stand in for
 * one: rc.13 cannot be made to fail a create or update with `CloudflareParseError` (the ⚠️ in
 * saas-oidc-error.ts), and the catch on those two calls still has to be proven wired. Nothing
 * else assigns here.
 */
export const sdkWrites = {
  create: zeroTrust.createAccessApplicationForAccount,
  update: zeroTrust.updateAccessApplicationForAccount,
};

const TRANSIENT_STATUS = (status: number): boolean =>
  status === 403 || status === 429 || status >= 500;

/**
 * ★ UPSTREAM'S OWN RETRY, EXACTLY (alchemy beta.81 `Cloudflare/Access/Application.ts`, the comment
 *   and `retryTransientAccessError` above `ApplicationProvider`): `AccessReferenceNotFound` is a
 *   freshly created policy still propagating, and `Forbidden` is how Cloudflare throttles a valid
 *   token. Capped exponential, about 45 seconds, then fail. The raw read joins it for the same
 *   statuses so it is throttled the way the SDK calls are.
 */
export const retryTransient = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.retry({
      while: (e) =>
        e._tag === 'AccessReferenceNotFound' ||
        e._tag === 'Forbidden' ||
        (e._tag === 'SaasOidcError' &&
          TRANSIENT_STATUS((e as unknown as SaasOidcError).status ?? 0)),
      schedule: Schedule.max([
        Schedule.min([Schedule.exponential('1 second', 1.5), Schedule.spaced('5 seconds')]),
        Schedule.recurs(12),
      ]),
    }),
  );

/**
 * ⛔ REFUSED BEFORE ANY WRITE while `DISTILLED_DEBUG_HTTP` is set: the SDK would print the create
 *   response, which carries the client secret, to stderr (protocol.ts). Read from `process.env`
 *   because that is what distilled reads, as mesh-node-token.ts does.
 */
export const refuseDebugHttp = Effect.suspend(() =>
  (globalThis.process?.env?.['DISTILLED_DEBUG_HTTP'] ?? '') === ''
    ? Effect.void
    : Effect.fail(
        new SaasOidcError({
          message:
            'Refusing to write a SaaS OIDC application while DISTILLED_DEBUG_HTTP is set: the SDK would print the response, which carries the client secret, to stderr. Unset it and run again.',
        }),
      ),
);

/**
 * The app with this id, from the wire JSON, or `undefined` when it is gone (404).
 * ⚠️ Error messages carry the reason and the status only: the request holds the bearer token.
 */
export const getApp = (accountId: string, appId: string) =>
  Effect.gen(function* () {
    const credentials = yield* yield* Credentials;
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(
      `${credentials.apiBaseUrl}/accounts/${accountId}/access/apps/${appId}`,
    ).pipe(HttpClientRequest.setHeaders(formatHeaders(credentials)), HttpClientRequest.acceptJson);
    const transport = (cause: { readonly message: string }) =>
      new SaasOidcError({ message: `Access application GET failed: ${cause.message}`, status: 0 });
    const response = yield* client.execute(request).pipe(Effect.mapError(transport));
    if (response.status === 404) return undefined;
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new SaasOidcError({
          message: `Access application GET returned ${response.status}`,
          status: response.status,
        }),
      );
    }
    const text = yield* response.text.pipe(Effect.mapError(transport));
    const body = yield* Effect.try({
      try: () => record(JSON.parse(text) as unknown),
      catch: () =>
        new SaasOidcError({ message: 'Access application GET was not JSON', status: 200 }),
    });
    const result = record(body?.['result']);
    return result === undefined ? undefined : parseApp(result);
  }).pipe(retryTransient);

/**
 * The live saas app with exactly this name, or `undefined`. The list payload carries no `saas_app`
 * (see the ⚠️ above), so the caller re-reads the match by id with `getApp`.
 * ⛔ Two matches are refused rather than resolved: Access does not enforce unique app names, so two
 *   means this package cannot tell which one is meant.
 */
export const findSaasByName = (accountId: string, name: string) =>
  zeroTrust.listAccessApplicationsForAccount.items({ accountId }).pipe(
    Stream.filter((app) => app.type === 'saas' && app.name === name),
    Stream.runCollect,
    Effect.catchTag('CloudflareParseError', withheld('application list')),
    retryTransient,
    Effect.flatMap((chunk) => {
      const ids = Array.from(chunk).flatMap((app) => (app.id == null ? [] : [app.id]));
      if (ids.length <= 1) return Effect.succeed(ids[0]);
      return Effect.fail(
        new SaasOidcError({
          message: `SaaS application name "${name}" matches ${ids.length} live apps (${ids.join(', ')}). Refusing to guess which one is meant; set \`applicationId\`.`,
        }),
      );
    }),
  );

const sdkBody = (write: AppWrite) => ({
  type: 'saas' as const,
  name: write.name,
  sessionDuration: write.sessionDuration,
  ...(write.allowedIdps === undefined ? {} : { allowedIdps: [...write.allowedIdps] }),
  ...(write.autoRedirectToIdentity === undefined
    ? {}
    : { autoRedirectToIdentity: write.autoRedirectToIdentity }),
  appLauncherVisible: write.appLauncherVisible,
  policies: [...write.policies],
  saasApp: {
    authType: write.saasApp.authType,
    redirectUris: [...write.saasApp.redirectUris],
    scopes: [...write.saasApp.scopes],
    grantTypes: [...write.saasApp.grantTypes],
    accessTokenLifetime: write.saasApp.accessTokenLifetime,
    allowPkceWithoutClientSecret: write.saasApp.allowPkceWithoutClientSecret,
    ...(write.saasApp.refreshTokenOptions === undefined
      ? {}
      : { refreshTokenOptions: write.saasApp.refreshTokenOptions }),
    ...(write.saasApp.appLauncherUrl === undefined
      ? {}
      : { appLauncherUrl: write.saasApp.appLauncherUrl }),
  } satisfies zeroTrust.AccessApplicationsCreateRequestSaasAppOIDCSaaSApp,
});

/** Create the app and return its id. The response's other fields are not trusted: re-read it. */
export const createApp = (accountId: string, write: AppWrite) =>
  refuseDebugHttp.pipe(
    Effect.andThen(
      sdkWrites
        .create({ accountId, ...sdkBody(write) })
        .pipe(
          Effect.catchTag('CloudflareParseError', withheld('application create')),
          retryTransient,
        ),
    ),
    Effect.flatMap((created) =>
      created.id == null
        ? Effect.fail(new SaasOidcError({ message: 'SaaS OIDC create did not return an id.' }))
        : Effect.succeed(created.id),
    ),
  );

export const updateApp = (accountId: string, appId: string, write: AppWrite) =>
  refuseDebugHttp.pipe(
    Effect.andThen(
      sdkWrites
        .update({ accountId, appId, ...sdkBody(write) })
        .pipe(
          Effect.catchTag('CloudflareParseError', withheld('application update')),
          retryTransient,
        ),
    ),
    Effect.asVoid,
  );

/**
 * Idempotent: an app already gone is a successful delete. Any other failure propagates, except
 * that a response the SDK cannot validate is withheld (see `withheld`).
 */
export const deleteApp = (accountId: string, appId: string) =>
  zeroTrust.deleteAccessApplicationForAccount({ accountId, appId }).pipe(
    Effect.asVoid,
    Effect.catchTags({
      AccessApplicationNotFound: () => Effect.void,
      CloudflareParseError: withheld('application delete'),
    }),
  );
