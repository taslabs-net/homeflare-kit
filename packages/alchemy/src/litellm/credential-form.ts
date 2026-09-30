/**
 * Refusals, wire bodies, the read shape and the comparison for `LiteLLM.Credential`, testable
 * without a server. Value handling is credential-values.ts's.
 *
 * ⛔ WHAT IS COMPARED, WITH THE VENDOR'S MASKING IN MIND. Both reads answer `credential_values`
 *   with SENSITIVE-keyed values masked (2 + `****` + 2, `*****` for a short string —
 *   `litellm_logging.py::_get_masked_values`, measured in the live 1.103.0 container) and
 *   `credential_info` in full:
 *   - `credential_info` is compared PER DECLARED KEY, with canonical-JSON deep equality — the
 *     PATCH route's merge assigns keys and never removes them (measured: `update_db_credential`),
 *     so a live key the declaration does not name is unmodelled and ignored rather than reported
 *     as drift. A declared key the row lacks IS drift: the row must be rewritten.
 *   - the values are compared only through the seal of the values this process RESOLVED
 *     (`valuesSeal`, credential-values.ts) — never against the masked fragments, which are
 *     partial secrets and are never copied into state.
 * ⚠️ THE UPDATE PATH IS A WHOLE-ROW REWRITE, NOT A PATCH, MEASURED, NOT A TASTE: the SDK's typed
 *   PATCH operation is wire-broken against the vendor — the generated request type marks
 *   `credential_name` as a path label ONLY, and core's `buildRequest` excludes a labelled member
 *   from the JSON body, while the vendor's PATCH body model (`UpdateCredentialItem` in
 *   `models/credentials.py` at 1.103.0) REQUIRES `credential_name` as a body field. Measured
 *   2026-09-30 with a stub fetch against the vendored SDK: the PATCH body is
 *   `{"credential_info": …, "credential_values": …}` with no `credential_name` — so every PATCH
 *   would answer FastAPI's `422` on a real proxy. This resource therefore rewrites a changed row
 *   with the vendor's own DELETE + POST, which both carry the name on the wire (the DELETE in the
 *   path, the POST in the body — both measured); the typed fix belongs in the distilled clone
 *   (a generated request type cannot express "path label AND body field"), never a hand-rolled
 *   HTTP call here (S23). Nothing is sent through `updateCredentialCredentialsCredentialNamePatch`.
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
 * The literal values a create or rewrite sends, unwrapped from their `Redacted` exactly once.
 * ⛔ EVERY DECLARED ENTRY IS SENT: the update path is a whole-row rewrite, so "the values this
 *   declaration names" is the whole managed set — there is no partial send that could leave a
 *   stale value behind under a declared key.
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
