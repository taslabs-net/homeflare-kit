/**
 * The form half of Bao.MfaLoginEnforcement — `identity/mfa/login-enforcement/<name>`: which logins
 * must pass which MFA methods.
 *
 * ★ READ FROM openbao v2.6.2 vault/identity/mfa.go handleMFALoginEnforcementUpdate (:511-646):
 *   · `mfa_method_ids` is required, and each id must exist in this namespace or a parent.
 *   · The four target lists are each `GetOk`: an omitted list KEEPS its stored value, and ANY list
 *     that is present — even empty — satisfies "one of … must be specified" (:634-636). So every
 *     list is sent on every write (a stale target is cleared), and "all four empty" — which the
 *     server would accept, and which enforces NOTHING — is refused here.
 *   · Every field is a TypeStringSlice (store.go:751-772). ⚠️ A comma string there is ONE element
 *     (sdk framework/field_data.go:343-356 WeakDecodes a string into a one-item slice), so lists
 *     go over as JSON arrays.
 * ⚠️ A TYPE TARGET IS BROAD. `authMethodTypes: ['jwt']` matches EVERY jwt-type mount — including a
 *   GitHub Actions or Kubernetes issuer mount, whose logins cannot answer a TOTP prompt. Target
 *   mounts by path (resolved to accessors) or by identity group instead.
 */
import { sha256 } from './digest.ts';
import { mountPath } from './mount-form.ts';

export interface BaoMfaLoginEnforcementProps {
  /** Enforcement name, unique per namespace. */
  name: string;
  /** Method ids — typically `[totp.methodId]`. Any ONE listed method passing is enough. */
  mfaMethodIds: readonly string[];
  /**
   * Auth mount PATHS (`oidc`, `jwt`), resolved to their accessors at plan and deploy time.
   * ⚠️ A plain string makes no graph edge. When the mount is a BaoAuthMethod in the same stack, pass
   *   its output (`[oidc.path]`) so it exists before this resolves — otherwise the deploy can reach
   *   this first and refuse with "no auth mount at …".
   */
  authMethodPaths?: readonly string[];
  /** Raw accessors (`auth_jwt_…`), for a mount outside this stack. */
  authMethodAccessors?: readonly string[];
  /** Auth mount TYPES — read the ⚠️ above first. */
  authMethodTypes?: readonly string[];
  /** Identity group ids whose members must pass MFA, on any mount. */
  identityGroupIds?: readonly string[];
  /** Identity entity ids, likewise. */
  identityEntityIds?: readonly string[];
}

/** The live shape, and the declared one once paths are resolved to accessors. */
export interface BaoMfaEnforcementCanonical {
  authMethodAccessors: readonly string[];
  authMethodTypes: readonly string[];
  identityEntityIds: readonly string[];
  identityGroupIds: readonly string[];
  mfaMethodIds: readonly string[];
}

/** ⛔ No secret — ids, accessors and names. */
export interface BaoMfaLoginEnforcementAttributes extends BaoMfaEnforcementCanonical {
  name: string;
  /** The server-made id. */
  enforcementId: string;
  namespacePath: string;
  digest: string;
}

const sortedSet = (values: readonly string[]) =>
  [...new Set(values.map((value) => value.trim()))].filter((value) => value !== '').sort();
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const text = (value: unknown) => (typeof value === 'string' ? value : '');

const canonical = (input: BaoMfaEnforcementCanonical): BaoMfaEnforcementCanonical => ({
  authMethodAccessors: sortedSet(input.authMethodAccessors),
  authMethodTypes: sortedSet(input.authMethodTypes),
  identityEntityIds: sortedSet(input.identityEntityIds),
  identityGroupIds: sortedSet(input.identityGroupIds),
  mfaMethodIds: sortedSet(input.mfaMethodIds),
});

/** The declaration, with `authMethodPaths` already resolved into `resolved` accessors. */
export const canonicalFromProps = (
  props: BaoMfaLoginEnforcementProps,
  resolved: readonly string[],
): BaoMfaEnforcementCanonical =>
  canonical({
    authMethodAccessors: [...(props.authMethodAccessors ?? []), ...resolved],
    authMethodTypes: props.authMethodTypes ?? [],
    identityEntityIds: props.identityEntityIds ?? [],
    identityGroupIds: props.identityGroupIds ?? [],
    mfaMethodIds: props.mfaMethodIds,
  });

export const canonicalFromLive = (live: Record<string, unknown>): BaoMfaEnforcementCanonical =>
  canonical({
    authMethodAccessors: strings(live['auth_method_accessors']),
    authMethodTypes: strings(live['auth_method_types']),
    identityEntityIds: strings(live['identity_entity_ids']),
    identityGroupIds: strings(live['identity_group_ids']),
    mfaMethodIds: strings(live['mfa_method_ids']),
  });

export const attributesOf = (
  name: string,
  live: Record<string, unknown>,
): BaoMfaLoginEnforcementAttributes => {
  const form = canonicalFromLive(live);
  return {
    ...form,
    digest: sha256(JSON.stringify(form)),
    enforcementId: text(live['id']),
    name,
    namespacePath: text(live['namespace_path']),
  };
};

export const matches = (
  attributes: BaoMfaLoginEnforcementAttributes,
  props: BaoMfaLoginEnforcementProps,
  resolved: readonly string[],
): boolean => attributes.digest === sha256(JSON.stringify(canonicalFromProps(props, resolved)));

/** Every list, as a JSON array, every time — the ⚠️ on GetOk above. */
export const writeBody = (form: BaoMfaEnforcementCanonical): Record<string, unknown> => ({
  auth_method_accessors: [...form.authMethodAccessors],
  auth_method_types: [...form.authMethodTypes],
  identity_entity_ids: [...form.identityEntityIds],
  identity_group_ids: [...form.identityGroupIds],
  mfa_method_ids: [...form.mfaMethodIds],
});

const NAME = /^\w(?:[\w.-]*\w)?$/;

export const problems = (
  props: BaoMfaLoginEnforcementProps,
  missingPaths: readonly string[],
): readonly string[] => {
  const found: string[] = [];
  if (!NAME.test(props.name)) found.push(`name \`${props.name}\` is not a valid enforcement name`);
  if (sortedSet(props.mfaMethodIds).length === 0) found.push('mfaMethodIds is empty');
  const targets = [
    props.authMethodPaths,
    props.authMethodAccessors,
    props.authMethodTypes,
    props.identityGroupIds,
    props.identityEntityIds,
  ].some((list) => sortedSet(list ?? []).length > 0);
  if (!targets) found.push('no target: an enforcement with none is accepted and enforces NOTHING');
  if (missingPaths.length > 0) {
    found.push(`no auth mount at ${missingPaths.map((path) => mountPath(path)).join(', ')}`);
  }
  return found;
};
