/**
 * The form half of Bao.JwtRole — a role on a `jwt` or `oidc` auth mount (one plugin, two names).
 *
 * ★ READ FROM openbao v2.6.2 builtin/credential/jwt/path_role.go, NOT RECALLED:
 *   · The write MERGES (pathRoleCreateUpdate :494-720): almost every field is `GetOk`, so an
 *     omitted one keeps its stored value — EXCEPT four that are rebuilt from `data.Get` on every
 *     write and so RESET when omitted: `role_type` (to `oidc`! :520-526), `bound_claims_type`
 *     (`string`), `callback_mode` (`client`) and `oidc_disable_confirmation` (false). All four are
 *     managed here, and every managed field is sent on every write, defaults included, so a value
 *     set by hand cannot survive behind a green plan.
 *   · `name` is a lower-case string (:77): `Admins` and `admins` are one role. Refused, not folded.
 *   · A `jwt` role needs one bound constraint (audiences, subject, claims or token CIDRs) and an
 *     `oidc` role needs allowed_redirect_uris (:694-709) — refused here with the same rule.
 *   · `bound_claims` is a TypeMap and `claim_mappings` a TypeKVPairs: sent as JSON OBJECTS. A JSON
 *     string is refused for a map (the ⛔ on mapValue in ssh-role-form.ts, measured 2026-09-21).
 * ⛔ `verbose_oidc_logging` AND `oidc_disable_confirmation` ARE ALWAYS SENT FALSE, and a live true
 *   plans `update`. The first logs received tokens and claims at debug level (:189-194); the second
 *   removes the confirmation page that guards direct-callback logins against token hijacking
 *   (RFC 8628 5.4, :205-210). Neither is a prop.
 * ⚠️ LEFT ALONE (merged, never sent): the three leeways, `oauth2_metadata`, `max_age`,
 *   `poll_interval`, `user_claim_json_pointer`, `token_policies_template_claims`,
 *   `token_strictly_bind_ip`. A hand-set value there survives, and is not compared.
 */
import {
  type BaoTokenForm,
  type BaoTokenProps,
  tokenBody,
  tokenFields,
  tokenFormOfLive,
  tokenFormOfProps,
  tokenProblems,
} from './auth-token-form.ts';
import { sha256 } from './digest.ts';
import { mountPath } from './mount-form.ts';

export type BaoJwtRoleType = 'jwt' | 'oidc';
export type BaoJwtCallbackMode = 'client' | 'device' | 'direct';

export interface BaoJwtRoleProps extends BaoTokenProps {
  /** Auth mount path, no trailing slash. Default `jwt`; an OIDC mount is often `oidc`. */
  mount?: string;
  /** Role name — lower case, as the server stores it. */
  name: string;
  /** ⛔ REQUIRED ON PURPOSE: the server's default is `oidc`, even when re-writing a `jwt` role. */
  roleType: BaoJwtRoleType;
  /** The claim that names the entity alias, e.g. `sub` or `email`. */
  userClaim: string;
  /** `aud` values; any one must match. */
  boundAudiences?: readonly string[];
  /** The `sub` a token must carry. */
  boundSubject?: string;
  /** How `boundClaims` values match. Default `string`. */
  boundClaimsType?: 'glob' | 'string';
  /** Claims that must match, each a value or a list of acceptable values. */
  boundClaims?: Readonly<Record<string, string | readonly string[]>>;
  /** Claim → alias metadata key. `role` is reserved, and two claims may not share a key. */
  claimMappings?: Readonly<Record<string, string>>;
  /** The claim that names identity group aliases. */
  groupsClaim?: string;
  /** OIDC only: the redirect URIs a login may return to. Required for `oidc`. */
  allowedRedirectUris?: readonly string[];
  /** OIDC only: scopes to request beyond `openid`. */
  oidcScopes?: readonly string[];
  /** OIDC only. Default `client`. */
  callbackMode?: BaoJwtCallbackMode;
}

/** Every managed field, normalised. Both sides are built by `canonical`, so key order matches. */
export interface BaoJwtRoleCanonical extends BaoTokenForm {
  allowedRedirectUris: readonly string[];
  boundAudiences: readonly string[];
  boundClaims: Readonly<Record<string, readonly string[]>>;
  boundClaimsType: string;
  boundSubject: string;
  callbackMode: string;
  claimMappings: Readonly<Record<string, string>>;
  groupsClaim: string;
  oidcDisableConfirmation: boolean;
  oidcScopes: readonly string[];
  roleType: string;
  userClaim: string;
  verboseOidcLogging: boolean;
}

/** ⛔ No secret: claim names, audiences, URIs, policy names and TTLs. */
export interface BaoJwtRoleAttributes extends BaoJwtRoleCanonical {
  mount: string;
  name: string;
  digest: string;
}

const sortedSet = (values: readonly string[]) => [...new Set(values)].sort();
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** ⚠️ A claim value and a one-element list match alike (claims.go normalizeList), so both → list. */
const claimsOf = (value: unknown): Record<string, readonly string[]> => {
  const source = record(value);
  const out: Record<string, readonly string[]> = {};
  for (const key of Object.keys(source).sort()) {
    const raw = source[key];
    out[key] = sortedSet(typeof raw === 'string' ? [raw] : strings(raw));
  }
  return out;
};

const mappingsOf = (value: unknown): Record<string, string> => {
  const source = record(value);
  const out: Record<string, string> = {};
  for (const key of Object.keys(source).sort()) out[key] = text(source[key]);
  return out;
};

const canonical = (input: BaoJwtRoleCanonical): BaoJwtRoleCanonical => ({
  allowedRedirectUris: sortedSet(input.allowedRedirectUris),
  boundAudiences: sortedSet(input.boundAudiences),
  boundClaims: claimsOf(input.boundClaims),
  boundClaimsType: input.boundClaimsType,
  boundSubject: input.boundSubject,
  callbackMode: input.callbackMode,
  claimMappings: mappingsOf(input.claimMappings),
  groupsClaim: input.groupsClaim,
  oidcDisableConfirmation: input.oidcDisableConfirmation,
  oidcScopes: sortedSet(input.oidcScopes),
  roleType: input.roleType,
  userClaim: input.userClaim,
  verboseOidcLogging: input.verboseOidcLogging,
  ...tokenFields(input),
});

export const canonicalFromProps = (props: BaoJwtRoleProps): BaoJwtRoleCanonical =>
  canonical({
    ...tokenFormOfProps(props),
    allowedRedirectUris: props.allowedRedirectUris ?? [],
    boundAudiences: props.boundAudiences ?? [],
    boundClaims: claimsOf(props.boundClaims ?? {}),
    boundClaimsType: props.boundClaimsType ?? 'string',
    boundSubject: props.boundSubject ?? '',
    callbackMode: props.callbackMode ?? 'client',
    claimMappings: props.claimMappings ?? {},
    groupsClaim: props.groupsClaim ?? '',
    oidcDisableConfirmation: false,
    oidcScopes: props.oidcScopes ?? [],
    roleType: props.roleType,
    userClaim: props.userClaim,
    verboseOidcLogging: false,
  });

export const canonicalFromLive = (live: Record<string, unknown>): BaoJwtRoleCanonical =>
  canonical({
    ...tokenFormOfLive(live),
    allowedRedirectUris: strings(live['allowed_redirect_uris']),
    boundAudiences: strings(live['bound_audiences']),
    boundClaims: claimsOf(live['bound_claims']),
    boundClaimsType: text(live['bound_claims_type']),
    boundSubject: text(live['bound_subject']),
    callbackMode: text(live['callback_mode']),
    claimMappings: mappingsOf(live['claim_mappings']),
    groupsClaim: text(live['groups_claim']),
    oidcDisableConfirmation: live['oidc_disable_confirmation'] === true,
    oidcScopes: strings(live['oidc_scopes']),
    roleType: text(live['role_type']),
    userClaim: text(live['user_claim']),
    verboseOidcLogging: live['verbose_oidc_logging'] === true,
  });

export const mountOf = (props: { mount?: string }): string => mountPath(props.mount ?? 'jwt');

export const rolePath = (props: { mount?: string; name: string }): string =>
  `auth/${mountOf(props)}/role/${props.name}`;

export const attributesOf = (
  props: BaoJwtRoleProps,
  live: Record<string, unknown>,
): BaoJwtRoleAttributes => {
  const form = canonicalFromLive(live);
  return { ...form, digest: sha256(JSON.stringify(form)), mount: mountOf(props), name: props.name };
};

export const matches = (attributes: BaoJwtRoleAttributes, props: BaoJwtRoleProps): boolean =>
  attributes.digest === sha256(JSON.stringify(canonicalFromProps(props)));

/** The PUT body — every managed field, the two fixed-false ones included (the ⛔ above). */
export const writeBody = (props: BaoJwtRoleProps): Record<string, unknown> => ({
  allowed_redirect_uris: [...(props.allowedRedirectUris ?? [])],
  bound_audiences: [...(props.boundAudiences ?? [])],
  bound_claims: { ...props.boundClaims },
  bound_claims_type: props.boundClaimsType ?? 'string',
  bound_subject: props.boundSubject ?? '',
  callback_mode: props.callbackMode ?? 'client',
  claim_mappings: { ...props.claimMappings },
  groups_claim: props.groupsClaim ?? '',
  oidc_disable_confirmation: false,
  oidc_scopes: [...(props.oidcScopes ?? [])],
  role_type: props.roleType,
  user_claim: props.userClaim,
  verbose_oidc_logging: false,
  ...tokenBody(props),
});

const NAME = /^[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?$/;

export const problems = (props: BaoJwtRoleProps): readonly string[] => {
  const found = [...tokenProblems(props)];
  if (!NAME.test(props.name))
    found.push(`name \`${props.name}\` must be lower case (the server folds it)`);
  if (props.userClaim.trim() === '') found.push('userClaim is empty; the server requires one');
  const bound =
    (props.boundAudiences?.length ?? 0) > 0 ||
    (props.boundSubject ?? '') !== '' ||
    Object.keys(props.boundClaims ?? {}).length > 0 ||
    (props.tokenBoundCidrs?.length ?? 0) > 0;
  if (props.roleType === 'jwt' && !bound) {
    found.push(
      'a jwt role needs a bound constraint: boundAudiences, boundSubject, boundClaims or tokenBoundCidrs',
    );
  }
  if (props.roleType === 'oidc' && (props.allowedRedirectUris?.length ?? 0) === 0) {
    found.push('an oidc role needs allowedRedirectUris');
  }
  const targets = Object.values(props.claimMappings ?? {});
  if (targets.includes('role')) found.push('claimMappings may not map to the reserved key `role`');
  if (new Set(targets).size !== targets.length)
    found.push('claimMappings maps two claims to one key');
  return found;
};
