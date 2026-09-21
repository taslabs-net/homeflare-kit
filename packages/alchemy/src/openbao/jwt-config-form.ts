/**
 * The form half of Bao.JwtAuthConfig — `auth/<mount>/config` for a mount that VALIDATES JWTs
 * (GitHub Actions OIDC, a Kubernetes issuer, a JWKS endpoint). NON-SECRET FIELDS ONLY.
 *
 * ⛔ `oidc_client_secret` IS NOT A PROP, AND THIS RESOURCE REFUSES TO TOUCH A MOUNT THAT HAS ONE.
 *   Three reasons, each sufficient:
 *   1. Alchemy stores props and attributes UNENCRYPTED in its state store (policy.ts), which is
 *      dumped nightly to another host. A client secret there outlives the vault that guards it.
 *   2. The read never returns it (path_config.go:266-315 lists every field it answers; the secret
 *      is not one, and it is `Sensitive`, :62-68), so a diff could never see it drift.
 *   3. THE WRITE IS A FULL REPLACE. pathConfigWrite (:321-345) builds the whole config from
 *      `d.Get`, so a write that leaves the secret out ERASES it — and with `oidc_client_id` still
 *      set the server refuses, while with both gone (:382-386) every OIDC browser login breaks.
 *   So a mount whose live config carries `oidc_client_id` is refused by `wouldErase`: configure
 *   an OIDC login mount by hand, or by a tool that reads the secret from KV at apply time.
 * ⚠️ THE WRITE CALLS OUT. With a discovery URL or JWKS URL the SERVER fetches it during the write
 *   (:387-420) and refuses on failure ("error checking oidc discovery URL"): the vault must reach
 *   the issuer, not only the machine running the plan.
 */
import { sha256 } from './digest.ts';
import { mountPath } from './mount-form.ts';

export interface BaoJwtAuthConfigProps {
  /** Auth mount path. Default `jwt`. */
  mount?: string;
  /** Issuer base URL, WITHOUT `/.well-known/openid-configuration` (the server refuses that). */
  oidcDiscoveryUrl?: string;
  /** PEM CA for the discovery URL, when its certificate is not publicly trusted. */
  oidcDiscoveryCaPem?: string;
  /** A JWKS URL, instead of discovery. */
  jwksUrl?: string;
  /** PEM CA for the JWKS URL. */
  jwksCaPem?: string;
  /** PEM PUBLIC keys, instead of either URL. */
  jwtValidationPubkeys?: readonly string[];
  /** Algorithms accepted. Default none — which the server reads as RS256. */
  jwtSupportedAlgs?: readonly string[];
  /** The `iss` a token must carry. */
  boundIssuer?: string;
  /** Role used when a login names none. Lower case. */
  defaultRole?: string;
}

export interface BaoJwtAuthConfigCanonical {
  boundIssuer: string;
  defaultRole: string;
  jwksCaPem: string;
  jwksUrl: string;
  jwtSupportedAlgs: readonly string[];
  jwtValidationPubkeys: readonly string[];
  oidcDiscoveryCaPem: string;
  oidcDiscoveryUrl: string;
}

/** ⛔ No secret — URLs, public keys, CA certificates, names. */
export interface BaoJwtAuthConfigAttributes extends BaoJwtAuthConfigCanonical {
  mount: string;
  digest: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const sortedSet = (values: readonly string[]) =>
  [...new Set(values.map((value) => value.trim()))].sort();

const canonical = (input: BaoJwtAuthConfigCanonical): BaoJwtAuthConfigCanonical => ({
  boundIssuer: input.boundIssuer.trim(),
  defaultRole: input.defaultRole.trim(),
  jwksCaPem: input.jwksCaPem.trim(),
  jwksUrl: input.jwksUrl.trim(),
  jwtSupportedAlgs: sortedSet(input.jwtSupportedAlgs),
  jwtValidationPubkeys: sortedSet(input.jwtValidationPubkeys),
  oidcDiscoveryCaPem: input.oidcDiscoveryCaPem.trim(),
  oidcDiscoveryUrl: input.oidcDiscoveryUrl.trim(),
});

export const canonicalFromProps = (props: BaoJwtAuthConfigProps): BaoJwtAuthConfigCanonical =>
  canonical({
    boundIssuer: props.boundIssuer ?? '',
    defaultRole: props.defaultRole ?? '',
    jwksCaPem: props.jwksCaPem ?? '',
    jwksUrl: props.jwksUrl ?? '',
    jwtSupportedAlgs: props.jwtSupportedAlgs ?? [],
    jwtValidationPubkeys: props.jwtValidationPubkeys ?? [],
    oidcDiscoveryCaPem: props.oidcDiscoveryCaPem ?? '',
    oidcDiscoveryUrl: props.oidcDiscoveryUrl ?? '',
  });

export const canonicalFromLive = (live: Record<string, unknown>): BaoJwtAuthConfigCanonical =>
  canonical({
    boundIssuer: text(live['bound_issuer']),
    defaultRole: text(live['default_role']),
    jwksCaPem: text(live['jwks_ca_pem']),
    jwksUrl: text(live['jwks_url']),
    jwtSupportedAlgs: strings(live['jwt_supported_algs']),
    jwtValidationPubkeys: strings(live['jwt_validation_pubkeys']),
    oidcDiscoveryCaPem: text(live['oidc_discovery_ca_pem']),
    oidcDiscoveryUrl: text(live['oidc_discovery_url']),
  });

export const mountOf = (props: { mount?: string }): string => mountPath(props.mount ?? 'jwt');

export const configPath = (props: { mount?: string }): string => `auth/${mountOf(props)}/config`;

export const attributesOf = (
  props: BaoJwtAuthConfigProps,
  live: Record<string, unknown>,
): BaoJwtAuthConfigAttributes => {
  const form = canonicalFromLive(live);
  return { ...form, digest: sha256(JSON.stringify(form)), mount: mountOf(props) };
};

export const matches = (attributes: BaoJwtAuthConfigAttributes, props: BaoJwtAuthConfigProps) =>
  attributes.digest === sha256(JSON.stringify(canonicalFromProps(props)));

/** Every non-secret field — the write is a full replace, so what is left out is reset. */
export const writeBody = (props: BaoJwtAuthConfigProps): Record<string, unknown> => ({
  bound_issuer: props.boundIssuer ?? '',
  default_role: props.defaultRole ?? '',
  jwks_ca_pem: props.jwksCaPem ?? '',
  jwks_url: props.jwksUrl ?? '',
  jwt_supported_algs: [...(props.jwtSupportedAlgs ?? [])],
  jwt_validation_pubkeys: [...(props.jwtValidationPubkeys ?? [])],
  oidc_discovery_ca_pem: props.oidcDiscoveryCaPem ?? '',
  oidc_discovery_url: props.oidcDiscoveryUrl ?? '',
});

/** Live fields the full-replace write would reset, which this resource deliberately does not model. */
export const wouldErase = (live: Record<string, unknown>): readonly string[] => {
  const lost: string[] = [];
  if (text(live['oidc_client_id']) !== '') lost.push('oidc_client_id (and its unreadable secret)');
  const provider = live['provider_config'];
  if (typeof provider === 'object' && provider !== null && Object.keys(provider).length > 0) {
    lost.push('provider_config');
  }
  if (text(live['oidc_response_mode']) !== '') lost.push('oidc_response_mode');
  if (strings(live['oidc_response_types']).length > 0) lost.push('oidc_response_types');
  if (strings(live['override_allowed_server_names']).length > 0) {
    lost.push('override_allowed_server_names');
  }
  return lost;
};

export const problems = (props: BaoJwtAuthConfigProps): readonly string[] => {
  const found: string[] = [];
  const sources = [
    (props.oidcDiscoveryUrl ?? '') !== '',
    (props.jwksUrl ?? '') !== '',
    (props.jwtValidationPubkeys?.length ?? 0) > 0,
  ].filter(Boolean).length;
  if (sources !== 1) {
    found.push('exactly one of oidcDiscoveryUrl, jwksUrl or jwtValidationPubkeys must be set');
  }
  if ((props.oidcDiscoveryUrl ?? '').includes('.well-known')) {
    found.push('oidcDiscoveryUrl must be the issuer, without /.well-known/openid-configuration');
  }
  const role = props.defaultRole ?? '';
  if (role !== role.toLowerCase()) found.push(`defaultRole \`${role}\` must be lower case`);
  return found;
};
