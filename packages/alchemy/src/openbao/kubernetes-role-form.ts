/**
 * The form half of Bao.KubernetesRole — `auth/<mount>/role/<name>` on a `kubernetes` auth mount:
 * which service accounts, in which namespaces, may log in, and what their token carries.
 *
 * ★ READ FROM openbao v2.6.2 builtin/credential/kubernetes/path_role.go, NOT RECALLED:
 *   · The write MERGES for names, namespaces, audience and alias source (`GetOk`, :335-392), but
 *     `bound_service_account_namespace_selector` is `data.Get` — RESET when omitted (:353). Every
 *     field is therefore sent on every write, defaults included.
 *   · Names may not be empty, and `*` may not be mixed with other names; namespaces may be empty
 *     only when a selector is set, with the same `*` rule (:335-372). Refused here first.
 *   · Roles are stored under the LOWER-CASED name (:396, backend.go:361), so a mixed-case name
 *     would read back as a different string. Refused, not folded.
 *   · `audience` is omitted from a read when empty (:206-208); read as `''`.
 * ⚠️ `aliasNameSource` DECIDES WHO A POD IS. `serviceaccount_uid` (OpenBao's default) names the
 *   entity alias by the service account's UID; `serviceaccount_name` by `<namespace>/<name>`
 *   (backend.go:30-34). Changing it on a live role re-names every pod's alias, so their next logins
 *   land on NEW entities and attribution splits.
 * ⛔ SO IT IS REQUIRED, NOT DEFAULTED (review 2026-09-21). Every field is sent on every write, so a
 *   default here would be WRITTEN: adopting a hand-made `serviceaccount_name` role with the prop
 *   left out would plan a bare `update` and silently re-key every pod onto new entities. The
 *   machine-access plan chose `serviceaccount_name`; the server's default is the other one — a
 *   choice this important is made in the declaration, the way Bao.JwtRole's `roleType` is.
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

export type BaoKubernetesAliasSource = 'serviceaccount_name' | 'serviceaccount_uid';

export interface BaoKubernetesRoleProps extends BaoTokenProps {
  /** Auth mount path. Default `kubernetes`. */
  mount?: string;
  /** Role name — lower case, as the server stores it. */
  name: string;
  /** Service account names; `['*']` for any. Never empty. */
  boundServiceAccountNames: readonly string[];
  /** Namespaces; `['*']` for any. May be empty only with a selector. */
  boundServiceAccountNamespaces?: readonly string[];
  /** A label selector (JSON or YAML) for namespaces, ORed with the list. */
  boundServiceAccountNamespaceSelector?: string;
  /** The `aud` a service account token must carry. Default none. */
  audience?: string;
  /** ⛔ Required — read the ⚠️ and ⛔ above before changing it on a live role. */
  aliasNameSource: BaoKubernetesAliasSource;
}

export interface BaoKubernetesRoleCanonical extends BaoTokenForm {
  aliasNameSource: string;
  audience: string;
  boundServiceAccountNames: readonly string[];
  boundServiceAccountNamespaceSelector: string;
  boundServiceAccountNamespaces: readonly string[];
}

/** ⛔ No secret: account names, namespaces, policy names, TTLs. */
export interface BaoKubernetesRoleAttributes extends BaoKubernetesRoleCanonical {
  mount: string;
  name: string;
  digest: string;
}

const sortedSet = (values: readonly string[]) => [...new Set(values)].sort();
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const canonical = (input: BaoKubernetesRoleCanonical): BaoKubernetesRoleCanonical => ({
  aliasNameSource: input.aliasNameSource,
  audience: input.audience,
  boundServiceAccountNames: sortedSet(input.boundServiceAccountNames),
  boundServiceAccountNamespaceSelector: input.boundServiceAccountNamespaceSelector.trim(),
  boundServiceAccountNamespaces: sortedSet(input.boundServiceAccountNamespaces),
  ...tokenFields(input),
});

export const canonicalFromProps = (props: BaoKubernetesRoleProps): BaoKubernetesRoleCanonical =>
  canonical({
    ...tokenFormOfProps(props),
    aliasNameSource: props.aliasNameSource,
    audience: props.audience ?? '',
    boundServiceAccountNames: props.boundServiceAccountNames,
    boundServiceAccountNamespaceSelector: props.boundServiceAccountNamespaceSelector ?? '',
    boundServiceAccountNamespaces: props.boundServiceAccountNamespaces ?? [],
  });

export const canonicalFromLive = (live: Record<string, unknown>): BaoKubernetesRoleCanonical =>
  canonical({
    ...tokenFormOfLive(live),
    aliasNameSource: text(live['alias_name_source']),
    audience: text(live['audience']),
    boundServiceAccountNames: strings(live['bound_service_account_names']),
    boundServiceAccountNamespaceSelector: text(live['bound_service_account_namespace_selector']),
    boundServiceAccountNamespaces: strings(live['bound_service_account_namespaces']),
  });

export const mountOf = (props: { mount?: string }): string =>
  mountPath(props.mount ?? 'kubernetes');

export const rolePath = (props: { mount?: string; name: string }): string =>
  `auth/${mountOf(props)}/role/${props.name}`;

export const attributesOf = (
  props: BaoKubernetesRoleProps,
  live: Record<string, unknown>,
): BaoKubernetesRoleAttributes => {
  const form = canonicalFromLive(live);
  return { ...form, digest: sha256(JSON.stringify(form)), mount: mountOf(props), name: props.name };
};

export const matches = (
  attributes: BaoKubernetesRoleAttributes,
  props: BaoKubernetesRoleProps,
): boolean => attributes.digest === sha256(JSON.stringify(canonicalFromProps(props)));

export const writeBody = (props: BaoKubernetesRoleProps): Record<string, unknown> => ({
  alias_name_source: props.aliasNameSource,
  audience: props.audience ?? '',
  bound_service_account_names: [...props.boundServiceAccountNames],
  bound_service_account_namespace_selector: props.boundServiceAccountNamespaceSelector ?? '',
  bound_service_account_namespaces: [...(props.boundServiceAccountNamespaces ?? [])],
  ...tokenBody(props),
});

const NAME = /^[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?$/;

const starMixed = (values: readonly string[]) => values.length > 1 && values.includes('*');

export const problems = (props: BaoKubernetesRoleProps): readonly string[] => {
  const found = [...tokenProblems(props)];
  const namespaces = props.boundServiceAccountNamespaces ?? [];
  const selector = (props.boundServiceAccountNamespaceSelector ?? '').trim();
  if (!NAME.test(props.name))
    found.push(`name \`${props.name}\` must be lower case (stored folded)`);
  if (props.boundServiceAccountNames.length === 0) found.push('boundServiceAccountNames is empty');
  if (starMixed(props.boundServiceAccountNames)) found.push('`*` mixed with other account names');
  if (namespaces.length === 0 && selector === '') {
    found.push('boundServiceAccountNamespaces is empty and no namespace selector is set');
  }
  if (starMixed(namespaces)) found.push('`*` mixed with other namespaces');
  return found;
};
