/**
 * The wire shapes of a SaaS OIDC application, and the parse that reads them: pure, no Effect, no
 * request. saas-oidc-api.ts says why the read is raw JSON (the SDK's responses drop `saas_app`).
 *
 * ⛔ `parseApp` COPIES NAMED FIELDS ONLY, and `client_secret` is not among them: an `ObservedApp`
 *   has nowhere to hold the client secret, so no code path can persist or log one.
 */

/** The OIDC half of a live SaaS app, from the wire JSON. */
export interface ObservedSaas {
  readonly authType: string | undefined;
  readonly clientId: string | undefined;
  readonly redirectUris: ReadonlyArray<string> | undefined;
  readonly scopes: ReadonlyArray<string> | undefined;
  readonly grantTypes: ReadonlyArray<string> | undefined;
  readonly accessTokenLifetime: string | undefined;
  readonly refreshTokenLifetime: string | undefined;
  readonly allowPkceWithoutClientSecret: boolean | undefined;
}

/** A live Access application as this package sees it. ⛔ There is no secret field, on purpose. */
export interface ObservedApp {
  readonly id: string | undefined;
  readonly aud: string | undefined;
  readonly type: string | undefined;
  readonly name: string | undefined;
  readonly domain: string | undefined;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly policyIds: ReadonlyArray<string>;
  readonly saasApp: ObservedSaas | undefined;
}

/** What a create or an update sends. Built by `writeBody` in saas-oidc-form.ts. */
export interface AppWrite {
  readonly name: string;
  readonly sessionDuration: string;
  readonly allowedIdps: ReadonlyArray<string> | undefined;
  readonly autoRedirectToIdentity: boolean | undefined;
  readonly appLauncherVisible: boolean;
  readonly policies: ReadonlyArray<string>;
  readonly saasApp: {
    readonly authType: 'oidc';
    readonly redirectUris: ReadonlyArray<string>;
    readonly scopes: ReadonlyArray<string>;
    readonly grantTypes: ReadonlyArray<string>;
    readonly accessTokenLifetime: string;
    readonly refreshTokenOptions?: { readonly lifetime: string };
    readonly allowPkceWithoutClientSecret: boolean;
    readonly appLauncherUrl: string | undefined;
  };
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;
const strings = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
export const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Named fields only, from Cloudflare's snake_case JSON. ⛔ `client_secret` is not among them, and
 * `public_key`, `custom_claims` and `hybrid_and_implicit_options` are not used by this resource.
 */
export const parseApp = (raw: Record<string, unknown>): ObservedApp => {
  const saas = record(raw['saas_app']);
  const refresh = record(saas?.['refresh_token_options']);
  const policies = Array.isArray(raw['policies']) ? raw['policies'] : [];
  return {
    id: str(raw['id']),
    aud: str(raw['aud']),
    type: str(raw['type']),
    name: str(raw['name']),
    domain: str(raw['domain']),
    createdAt: str(raw['created_at']),
    updatedAt: str(raw['updated_at']),
    policyIds: policies.flatMap((policy) => {
      const id = str(record(policy)?.['id']);
      return id === undefined ? [] : [id];
    }),
    saasApp:
      saas === undefined
        ? undefined
        : {
            authType: str(saas['auth_type']),
            clientId: str(saas['client_id']),
            redirectUris: strings(saas['redirect_uris']),
            scopes: strings(saas['scopes']),
            grantTypes: strings(saas['grant_types']),
            accessTokenLifetime: str(saas['access_token_lifetime']),
            refreshTokenLifetime: str(refresh?.['lifetime']),
            allowPkceWithoutClientSecret: bool(saas['allow_pkce_without_client_secret']),
          },
  };
};
