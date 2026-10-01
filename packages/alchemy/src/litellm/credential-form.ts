/**
 * Refusals, wire bodies, the read shape and the comparison for `LiteLLM.Credential`, testable
 * without a server. Value handling is credential-values.ts's.
 *
 * ⛔ WHAT IS COMPARED, WITH THE VENDOR'S MASKING IN MIND. Both reads answer `credential_values`
 *   with SENSITIVE-keyed values masked (2 + `****` + 2, `*****` for a short string —
 *   `litellm_logging.py::_get_masked_values`, measured in the live 1.103.0 container) and
 *   `credential_info` in full:
 *   - `credential_info` is compared PER DECLARED KEY, with canonical-JSON deep equality — the
 *     PATCH route's merge assigns keys and never removes them (measured: `update_db_credential`,
 *     `merged_credential.credential_info.update(...)`), so a live key the declaration does not
 *     name is unmodelled and ignored rather than reported as drift — EXCEPT a key the PRIOR
 *     declaration named, which is a removal and must be dropped with a whole-row rewrite
 *     (`removedInfoKeys`, consumed by credential.ts). A declared key the row lacks IS drift.
 *   - the values are compared only through the seal of the values this process RESOLVED
 *     (`valuesSeal`, credential-values.ts) — never against the masked fragments, which are
 *     partial secrets and are never copied into state.
 * ★ A CHANGED ROW IS PATCHED, NOT REWRITTEN. The vendor's PATCH merges by key
 *   (`update_db_credential`), so updating a value or an `info` entry is a PATCH carrying the
 *   declared `credential_info` and (only when the values are stale) the resolved
 *   `credential_values`. A PATCH that fails on the wire leaves the row it was merging into — the
 *   fix for the review's finding 3, where a DELETE + POST rewrite left NO row when the POST failed
 *   after the DELETE. The one thing PATCH cannot do is REMOVE a key, so a declaration that drops
 *   a previously-declared `info` key is still a whole-row rewrite (credential.ts decides). The
 *   PATCH body carries `credential_name` IN THE BODY as a second member (`credential_name_body`,
 *   wire-named `credential_name`) because the vendor's `UpdateCredentialItem` requires it and a
 *   Smithy member has one binding — the path label can't also be the body field; the distilled
 *   patch for it is `patches/credential_management/update_credential_credentials__credential_name__patch.json`.
 */
import type * as credentials from '@distilled.cloud/litellm/credential_management';
import * as Redacted from 'effect/Redacted';
import {
  type CredentialAttributes,
  type CredentialProps,
  isBlank,
  isSensitiveKey,
} from './credential-types.ts';
import type { ResolvedValues } from './credential-values.ts';

/** The first reason a declaration is refused, or `undefined`. Pure: no environment, no server. */
export const firstProblem = (props: CredentialProps): string | undefined => {
  if (isBlank(props.credentialName) || props.credentialName !== props.credentialName.trim()) {
    return '`credentialName` must be a non-empty string without leading or trailing whitespace';
  }
  if (
    props.credentialInfo !== undefined &&
    (typeof props.credentialInfo !== 'object' || props.credentialInfo === null)
  ) {
    return '`credentialInfo` must be an object of metadata';
  }
  if (props.credentialInfo !== undefined) {
    for (const key of Object.keys(props.credentialInfo)) {
      if (isSensitiveKey(key)) {
        return (
          `\`credentialInfo\` must not declare "${key}": LiteLLM returns \`credential_info\` ` +
          'unmasked, so declare it in `credentialValues`, which LiteLLM stores encrypted'
        );
      }
    }
  }
  if (Object.keys(props.credentialValues).length === 0) {
    return (
      '`credentialValues` needs at least one entry: LiteLLM refuses a credential with neither ' +
      '`credential_values` nor a model_id, and `model_id` is not modelled here'
    );
  }
  for (const key of Object.keys(props.credentialValues)) {
    if (isBlank(key) || key !== key.trim()) {
      return '`credentialValues` keys must be non-empty strings without padding';
    }
    const entry = props.credentialValues[key];
    if (typeof entry !== 'object' || entry === null || isBlank(entry.fromEnv)) {
      return `\`credentialValues["${key}"]\` takes \`{ fromEnv: 'NAME' }\`, never a value: the value would land in Alchemy's unencrypted state`;
    }
  }
  return undefined;
};

/**
 * Wire names of the fields where the live row and the declaration disagree, for a
 * `NotConvergedError` and for the drift decision. The NAME is identity — a changed name plans a
 * REPLACE in credential.ts and is never compared here. Values are never compared against the
 * live row at all: the seal decides (credential-values.ts).
 */
export const differing = (
  live: CredentialAttributes,
  props: CredentialProps,
): readonly string[] => {
  const out: string[] = [];
  if (props.credentialInfo !== undefined) {
    for (const [key, declared] of Object.entries(props.credentialInfo)) {
      if (!isSensitiveKey(key) && !jsonEquals(live.credentialInfo[key], declared)) {
        out.push(`credential_info.${key}`);
      }
    }
  }
  return out;
};

/** Canonical-JSON deep equality, order-insensitive for objects. */
const jsonEquals = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalise(left)) === JSON.stringify(canonicalise(right));

const canonicalise = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

/**
 * One row of a credentials read, as attributes. ⛔ COPIES NO `credential_values` ENTRY: a masked
 * fragment (`sk****45`) is a partial secret, and a sensitive key the read masks would land half a
 * secret in Alchemy's state. The `credential_info` mirror drops SENSITIVE-KEYED entries (they are
 * returned unmasked and would mirror a clear secret into state). The digest is the caller's
 * (credential.ts fills `valuesSeal` from state; a row cannot supply one).
 */
export const toAttributes = (row: Record<string, unknown>): CredentialAttributes => {
  const info = (row['credential_info'] ?? {}) as Record<string, unknown>;
  const mirrored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!isSensitiveKey(key)) mirrored[key] = value;
  }
  return {
    credentialInfo: mirrored,
    credentialName: String(row['credential_name'] ?? ''),
    valuesSeal: '',
  };
};

/** The rows a credentials read carries, `CredentialItem`-shaped. */
export const isCredentialRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' &&
  row !== null &&
  typeof (row as Record<string, unknown>)['credential_name'] === 'string';

/**
 * The literal values a create or a values-stale PATCH sends, unwrapped from their `Redacted`
 * exactly once. ⛔ EVERY DECLARED ENTRY IS SENT: the whole-row create and the values-stale PATCH
 * both demand every declared value (`requireValues`), so there is no partial send that could
 * leave a stale value behind under a declared key.
 */
export const literalValues = (resolved: ResolvedValues): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(resolved.values).map(([key, value]) => [key, Redacted.value(value)]),
  );

/** The body `POST /credentials` carries — the name IN THE BODY (measured with a stub fetch). */
export const createBody = (
  props: CredentialProps,
  resolved: ResolvedValues,
): credentials.CreateCredentialCredentialsPostRequest => {
  const body: Record<string, unknown> = {
    credential_info: { ...props.credentialInfo },
    credential_name: props.credentialName,
    credential_values: { ...literalValues(resolved) },
  };
  return body as unknown as credentials.CreateCredentialCredentialsPostRequest;
};

/**
 * The body `PATCH /credentials/{name}` carries — the declared `credential_info` always (the
 * vendor's `UpdateCredentialItem` REQUIRES it, and the merge assigns every declared key), the
 * resolved `credential_values` only when the caller passes them (a values-stale write; an
 * info-only drift sends none, so it never demands a value the environment does not hold).
 *
 * ⛔ `credential_name` APPEARS TWICE, ON PURPOSE: `credential_name` is the path label (its URI
 *   placeholder is the row's address), and `credential_name_body` is the SAME value as a body
 *   field wire-named `credential_name` — the vendor's `UpdateCredentialItem` requires the name in
 *   the body, a Smithy member can carry only ONE binding, and the kit never renames in place (a
 *   changed name is a REPLACE, credential.ts), so the two are always equal here.
 */
export const patchBody = (
  props: CredentialProps,
  values: Readonly<Record<string, unknown>> | undefined,
): credentials.UpdateCredentialCredentialsCredentialNamePatchRequest => {
  const body: Record<string, unknown> = {
    credential_info: { ...props.credentialInfo },
    credential_name: props.credentialName,
    credential_name_body: props.credentialName,
  };
  if (values !== undefined) body.credential_values = { ...values };
  return body as unknown as credentials.UpdateCredentialCredentialsCredentialNamePatchRequest;
};

/**
 * The `credential_info` keys the PRIOR declaration named and this one does not — a key the PATCH
 * merge cannot remove, so a whole-row rewrite is the only way to drop it. `undefined` prior (an
 * adopt or a first write) has no prior declaration to drop keys from, so nothing is removed.
 * Sensitive-keyed entries are never mirrored into attributes (toAttributes skips them), so they
 * can never be removed here either — and they were refused at plan time, so none was declared.
 */
export const removedInfoKeys = (
  prior: CredentialAttributes | undefined,
  props: CredentialProps,
): readonly string[] => {
  if (prior === undefined) return [];
  const declared = props.credentialInfo ?? {};
  return Object.keys(prior.credentialInfo).filter((key) => !(key in declared));
};
