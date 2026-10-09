/**
 * The declared shape of `HomeFlare.Access.SaasOidcApplication` and what it reports back, apart from
 * the pure helpers that use them (saas-oidc-form.ts re-exports both types, so imports keep working).
 *
 * ★ EVERY PROP FIELD CARRIES A JSDOC (provider standard S5). Where the wording below is the API's,
 *   it is the SDK's own field doc on the request type
 *   (`@distilled.cloud/cloudflare@1.0.0-rc.13` `zero-trust` `CreateAccessApplicationForAccountRequest`
 *   and `AccessApplicationsCreateRequestSaasAppOIDCSaaSApp`, src/services/zero_trust.ts:9025-9053 and
 *   :9728-9794), so a reader gets the vendor's meaning without leaving the editor.
 * ⛔ THE ATTRIBUTES NEVER HOLD THE CLIENT SECRET, and nothing here can: there is no field for it.
 */

/**
 * An OIDC flow Access can serve for the client: the five literals the SDK names
 * (`AccessApplicationsCreateRequestSaasAppOIDCSaaSAppGrantTypesItem`, zero_trust.ts:8946-8951).
 */
export type OidcGrantType =
  | 'authorization_code'
  | 'authorization_code_with_pkce'
  | 'refresh_tokens'
  | 'hybrid'
  | 'implicit';

/** The user information the client may request from Access. */
export type OidcScope = 'openid' | 'email' | 'profile' | 'groups';

export interface SaasOidcApplicationProps {
  /**
   * Live Access application UUID. Set this when adopting a SaaS app that already exists. Without
   * it the app is found by exact `name` among saas apps, which also works but refuses two matches.
   */
  readonly applicationId?: string;
  /** The app's name. Defaults to a physical name derived from the logical id. */
  readonly name?: string;
  /**
   * The Zero Trust team domain the issuer lives on, a bare hostname such as
   * `example.cloudflareaccess.com`: no scheme, no path. Not read from the environment, so the
   * issuer in the attributes is the one the declaration says.
   */
  readonly teamDomain: string;
  /**
   * How long Access sessions for this app last, in the API's duration format (`300ms` or `2h45m`).
   * Written on create and on any sync; not drift-checked.
   * @default '24h'
   */
  readonly sessionDuration?: string;
  /**
   * Ids of the identity providers users may pick for this app. Written on create and on any sync;
   * not drift-checked.
   * @default every IdP configured in the account (the field is left out of the write)
   */
  readonly allowedIdps?: ReadonlyArray<string>;
  /**
   * `true` makes users skip the identity-provider selection step; the API requires exactly one
   * entry in `allowedIdps` then. Written on create and on any sync; not drift-checked.
   * @default left out of the write (the API's default)
   */
  readonly autoRedirectToIdentity?: boolean;
  /**
   * Show the app in the App Launcher. Written on create and on any sync; not drift-checked.
   * @default false
   */
  readonly appLauncherVisible?: boolean;
  /**
   * Ids of reusable Access policies, in ascending order of precedence (the SDK's own wording:
   * zero_trust.ts:9774). The ORDER is part of the declaration: a reorder is drift and is synced.
   */
  readonly policies: ReadonlyArray<string>;
  /** The OIDC client: the `saas_app` object of the Access application. */
  readonly saasApp: {
    /** The authentication protocol of the SaaS app. Only `oidc` is supported by this resource. */
    readonly authType: 'oidc';
    /**
     * The permitted URLs for Cloudflare to return authorization codes and tokens to. Compared as
     * a set (order is not significant to the API).
     */
    readonly redirectUris: ReadonlyArray<string>;
    /** The user information shared with the client. Compared as a set. */
    readonly scopes: ReadonlyArray<OidcScope>;
    /** The OIDC flows the client may use. Compared as a set. */
    readonly grantTypes: ReadonlyArray<OidcGrantType>;
    /** Lifetime of the access token after creation: `m` or `h` units, `1m` to `24h` (the SDK field doc). */
    readonly accessTokenLifetime: string;
    /**
     * How long a refresh token is valid after creation: `m`, `h` or `d` units, longer than `1m`
     * (the SDK field doc). Needed for the `refresh_tokens` grant. Sent as `refreshTokenOptions.lifetime`.
     * @default left out of the write
     */
    readonly refreshTokenLifetime?: string;
    /**
     * `true` makes this a PUBLIC client: the token endpoint does not require a client secret when
     * the `authorization_code_with_pkce` grant is used, and then no secret exists to keep. Refused
     * without that grant.
     * @default false (a confidential client)
     */
    readonly allowPkceWithoutClientSecret?: boolean;
    /**
     * The URL the app's tile in the App Launcher sends users to. Written on create and on any
     * sync; not drift-checked.
     * @default left out of the write
     */
    readonly appLauncherUrl?: string;
  };
}

export interface SaasOidcApplicationAttributes {
  /** The Access application UUID. */
  readonly applicationId: string;
  /** The application audience tag, the `aud` of the Access JWTs for this app. */
  readonly aud: string;
  /** The `domain` Cloudflare reports for the app (the OIDC issuer without its scheme). */
  readonly domain: string;
  /** The app's name as Cloudflare reports it. */
  readonly name: string;
  /** The account the app lives in. */
  readonly accountId: string;
  /** The declared team domain (or, for state that predates the prop, the host Cloudflare reports). */
  readonly teamDomain: string;
  /** The OIDC client id, for the relying party's configuration. */
  readonly clientId: string;
  /** `https://<teamDomain>/cdn-cgi/access/sso/oidc/<clientId>`. */
  readonly issuer: string;
  /** `<issuer>/authorization`. */
  readonly authorizationEndpoint: string;
  /** `<issuer>/token`. */
  readonly tokenEndpoint: string;
  /** The signing keys, for a verifier that validates ID tokens. */
  readonly jwksEndpoint: string;
  /** `<issuer>/userinfo`. */
  readonly userinfoEndpoint: string;
  /** `<issuer>/.well-known/openid-configuration`. */
  readonly configurationEndpoint: string;
  /** The redirect URIs the live app permits. */
  readonly redirectUris: ReadonlyArray<string>;
  /** The scopes the live app serves. */
  readonly scopes: ReadonlyArray<string>;
  /** The grant types the live app allows. */
  readonly grantTypes: ReadonlyArray<string>;
  /** The live access token lifetime, or `''` when Cloudflare reports none. */
  readonly accessTokenLifetime: string;
  /** The live refresh token lifetime, or `''` when Cloudflare reports none. */
  readonly refreshTokenLifetime: string;
  /** When Cloudflare created the app, if it says. */
  readonly createdAt: string | undefined;
  /** When Cloudflare last updated the app, if it says. */
  readonly updatedAt: string | undefined;
}
