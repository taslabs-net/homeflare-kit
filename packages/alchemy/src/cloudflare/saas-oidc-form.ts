/**
 * `HomeFlare.Access.SaasOidcApplication` — the pure helpers the lifecycle uses: validation, the
 * issuer URLs, drift, the write body and the attribute mapping. The props and attributes types are
 * declared in saas-oidc-props.ts and re-exported here.
 *
 * ⛔ THE ATTRIBUTES NEVER HOLD THE CLIENT SECRET, and nothing here can: `ObservedApp`
 *   (saas-oidc-api.ts) has no field for it. A client that authenticates with PKCE alone declares
 *   `allowPkceWithoutClientSecret: true`, and then no secret exists to keep.
 * ★ THE ISSUER IS `https://<teamDomain>/cdn-cgi/access/sso/oidc/<clientId>`. The team domain is a
 *   prop; the openbao copy this came from hardcoded one account's. Cloudflare also reports the
 *   same host in the app's own `domain` field (Alchemy's `Access.Application` doc: for `saas`
 *   "Cloudflare uses the OIDC issuer"), and `checkTeam` refuses a declaration that disagrees with it.
 */
import { SaasOidcError } from './saas-oidc-error.ts';
import type { SaasOidcApplicationAttributes, SaasOidcApplicationProps } from './saas-oidc-props.ts';
import type { AppWrite, ObservedApp } from './saas-oidc-wire.ts';

// The declared shape lives in saas-oidc-props.ts (every field documented there); re-exported so
// the module that always held it keeps answering to its old name.
export type {
  OidcGrantType,
  OidcScope,
  SaasOidcApplicationAttributes,
  SaasOidcApplicationProps,
} from './saas-oidc-props.ts';

const HOSTNAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

/** ⛔ Fail closed on a declaration the API would accept but nobody meant. */
export const validateSaasOidc = (props: SaasOidcApplicationProps): SaasOidcError | undefined => {
  const fail = (message: string) => new SaasOidcError({ message });
  if (typeof props.teamDomain !== 'string' || !HOSTNAME.test(props.teamDomain)) {
    return fail(
      `SaasOidcApplication \`teamDomain\` must be a bare lowercase hostname such as "example.cloudflareaccess.com" (no scheme, no path); got ${JSON.stringify(props.teamDomain)}.`,
    );
  }
  if (props.name !== undefined && props.name.trim() === '') {
    return fail('SaasOidcApplication `name`, when set, must not be empty.');
  }
  if (
    props.saasApp.allowPkceWithoutClientSecret === true &&
    !props.saasApp.grantTypes.includes('authorization_code_with_pkce')
  ) {
    return fail(
      '`allowPkceWithoutClientSecret: true` only applies to the `authorization_code_with_pkce` grant; add it to `grantTypes` or drop the flag.',
    );
  }
  return undefined;
};

export const issuerFor = (teamDomain: string, clientId: string): string =>
  `https://${teamDomain}/cdn-cgi/access/sso/oidc/${clientId}`;

const hostOf = (domain: string): string => domain.split('/')[0]?.toLowerCase() ?? '';

/**
 * ⛔ A DECLARED TEAM DOMAIN THAT DISAGREES WITH THE APP'S OWN `domain` is refused: the issuer in
 *   the attributes would point at a different team than the one that holds the app.
 * ⛔ WHEN CLOUDFLARE REPORTS NO `domain` there is nothing to compare, so the team the row already
 *   recorded (`knownTeam`, from state) stands in: a declaration that moves it is refused, because
 *   `issuer` is a declared stable and must not move under the row. With no `knownTeam` either
 *   (a first create or a cold adoption) there is nothing to compare against and the declaration
 *   stands.
 */
export const checkTeam = (
  teamDomain: string,
  app: ObservedApp,
  knownTeam?: string,
): SaasOidcError | undefined => {
  if (app.domain === undefined) {
    return knownTeam === undefined || knownTeam.toLowerCase() === teamDomain.toLowerCase()
      ? undefined
      : new SaasOidcError({
          message: `SaasOidcApplication declares teamDomain "${teamDomain}" but the row recorded "${knownTeam}" and Cloudflare reports no domain for the app to confirm the change. The issuer cannot move; revert the declaration.`,
        });
  }
  return hostOf(app.domain) === teamDomain.toLowerCase()
    ? undefined
    : new SaasOidcError({
        message: `SaasOidcApplication declares teamDomain "${teamDomain}" but Cloudflare reports the app on "${hostOf(app.domain)}".`,
      });
};

const refreshLifetime = (props: SaasOidcApplicationProps): string =>
  props.saasApp.refreshTokenLifetime ?? '';

/** The request body for a create or an update. */
export const writeBody = (news: SaasOidcApplicationProps, name: string): AppWrite => ({
  name,
  sessionDuration: news.sessionDuration ?? '24h',
  allowedIdps: news.allowedIdps,
  autoRedirectToIdentity: news.autoRedirectToIdentity,
  appLauncherVisible: news.appLauncherVisible ?? false,
  policies: news.policies,
  saasApp: {
    authType: 'oidc',
    redirectUris: news.saasApp.redirectUris,
    scopes: news.saasApp.scopes,
    grantTypes: news.saasApp.grantTypes,
    accessTokenLifetime: news.saasApp.accessTokenLifetime,
    ...(news.saasApp.refreshTokenLifetime === undefined
      ? {}
      : { refreshTokenOptions: { lifetime: news.saasApp.refreshTokenLifetime } }),
    allowPkceWithoutClientSecret: news.saasApp.allowPkceWithoutClientSecret ?? false,
    appLauncherUrl: news.saasApp.appLauncherUrl,
  },
});

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string> | undefined): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...(b ?? [])].sort());

/**
 * ⛔ ORDER MATTERS FOR POLICIES: `policies` is "in ascending order of precedence" (the SDK's own
 *   field doc, zero_trust.ts:9774), so `[a, b]` and `[b, a]` are different declarations. A set
 *   compare here would let a reorder go unnoticed and leave the live precedence unchanged.
 *   `parseApp` hands the observed ids over already ordered by the API's `precedence`.
 */
const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string> | undefined): boolean => {
  const other = b ?? [];
  return a.length === other.length && a.every((item, index) => item === other[index]);
};

/**
 * Does the live app differ from the declaration? Compared: name, auth type, redirect URIs, scopes,
 * grant types (each as a set), both lifetimes, the PKCE flag and the policies IN ORDER — the
 * openbao copy's set plus the policy order, kept so adopting a live app is not newly a write.
 * ⚠️ NOT COMPARED: `sessionDuration`, `allowedIdps`, `autoRedirectToIdentity`, `appLauncherVisible`,
 *   `appLauncherUrl`. They are written on create and on any sync, but a change to only those does
 *   not trigger one. Carried over unchanged; see saas-oidc.md.
 */
export const needsSync = (
  news: SaasOidcApplicationProps,
  observed: ObservedApp,
  name: string,
): boolean => {
  const saas = observed.saasApp;
  return (
    (observed.name ?? '') !== name ||
    (saas?.authType ?? '') !== 'oidc' ||
    !sameSet(news.saasApp.redirectUris, saas?.redirectUris) ||
    !sameSet(news.saasApp.scopes, saas?.scopes) ||
    !sameSet(news.saasApp.grantTypes, saas?.grantTypes) ||
    (saas?.accessTokenLifetime ?? '') !== news.saasApp.accessTokenLifetime ||
    refreshLifetime(news) !== (saas?.refreshTokenLifetime ?? '') ||
    (saas?.allowPkceWithoutClientSecret ?? false) !==
      (news.saasApp.allowPkceWithoutClientSecret ?? false) ||
    !sameList(news.policies, observed.policyIds)
  );
};

/**
 * The attributes of a live app, or `undefined` when it lacks an id, an `aud` or a client id (so it
 * is not a SaaS OIDC app this package can describe). `teamDomain` is the declared one, or, for a
 * read that has no declaration (state written before the prop existed), the host Cloudflare reports.
 */
export const toAttributes = (
  app: ObservedApp,
  accountId: string,
  fallbackName: string,
  declaredTeam: string | undefined,
): SaasOidcApplicationAttributes | undefined => {
  const clientId = app.saasApp?.clientId;
  const teamDomain = declaredTeam ?? (app.domain === undefined ? undefined : hostOf(app.domain));
  if (app.id === undefined || app.aud === undefined || clientId === undefined) return undefined;
  if (teamDomain === undefined || teamDomain === '') return undefined;
  const issuer = issuerFor(teamDomain, clientId);
  const saas = app.saasApp;
  return {
    applicationId: app.id,
    aud: app.aud,
    domain: app.domain ?? issuer.replace('https://', ''),
    name: app.name ?? fallbackName,
    accountId,
    teamDomain,
    clientId,
    issuer,
    authorizationEndpoint: `${issuer}/authorization`,
    tokenEndpoint: `${issuer}/token`,
    jwksEndpoint: `${issuer}/jwks`,
    userinfoEndpoint: `${issuer}/userinfo`,
    configurationEndpoint: `${issuer}/.well-known/openid-configuration`,
    redirectUris: saas?.redirectUris ?? [],
    scopes: saas?.scopes ?? [],
    grantTypes: saas?.grantTypes ?? [],
    accessTokenLifetime: saas?.accessTokenLifetime ?? '',
    refreshTokenLifetime: saas?.refreshTokenLifetime ?? '',
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
};
