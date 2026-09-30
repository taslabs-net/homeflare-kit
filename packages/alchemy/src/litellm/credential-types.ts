/**
 * What `LiteLLM.Credential` declares (props) and what is remembered about it (attributes).
 *
 * ⛔ NO CREDENTIAL VALUE IS EVER A PROP OR AN ATTRIBUTE (S25). Alchemy persists props AND
 *   attributes unencrypted (`StateEncoding.ts` writes a `Redacted` value's inner string beside
 *   the tag — `secrets/write-only.ts`, measured on alchemy 2.0.0-beta.79), and LiteLLM stores a
 *   credential's values ENCRYPTED in its database while the reads answer them MASKED, so a value
 *   the declaration holds is `{ fromEnv: 'NAME' }` — NAME lands in state, and the value is read
 *   from the DEPLOYING process's environment only when a write is being made
 *   (`credential-values.ts`, the same shape `McpServerProps.authValue` uses). Unlike a model
 *   deployment's `os.environ/NAME` reference (the PROXY resolves that in its own environment),
 *   the credential table stores LITERAL values — measured in the live 1.103.0 container
 *   (`credential_endpoints/endpoints.py`: `create_credential` encrypts the body's
 *   `credential_values` before the insert, `CredentialsRepository.create`) — so the proxy could
 *   not resolve a reference here even if one were sent.
 * ⛔ THE LIVE ROW'S MASKED VALUES ARE NEVER MIRRORED INTO ATTRIBUTES. Both reads answer
 *   `credential_values` with every SENSITIVE-keyed value masked (the vendor's own rule,
 *   `_get_masked_values` in `litellm_logging.py`: a key matching `authorization`, `token`, `key`,
 *   `secret`, `vertex_credentials`, `credentials`, `password` or `passwd` — substring,
 *   case-insensitive — answers `v[:2] + "****" + v[-2:]` for a string longer than four
 *   characters, `*****` otherwise; non-string values and non-sensitive keys answer in full).
 *   A masked fragment (`sk****45`) is a PARTIAL SECRET, so `toAttributes` copies no
 *   `credential_values` entry at all (`credential-form.ts`); what was last written is remembered
 *   as the digest of the values this process RESOLVED, `valuesSeal` — never the values.
 * ⚠️ `credential_info` IS COMPARED, BUT ONLY PER DECLARED KEY, AND ONLY ENTRIES THE VENDOR
 *   RETURNS: the PATCH route merges by assignment and can never REMOVE a key (measured:
 *   `update_db_credential` — `merged.credential_info.update(...)`), so a live key the declaration
 *   does not name is unmodelled on purpose and ignored by the comparison. An `info` key that
 *   matches the vendor's own sensitive-key list is refused at plan time (credential-form.ts): the
 *   vendor returns `credential_info` UNMASKED, so declaring a secret there would store it in
 *   clear in LiteLLM's row and in Alchemy's state, and never read back masked.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/**
 * The credential's name — its identity in the vendor's table (a unique column, enforced by the
 * database, `schema.prisma`'s `Credentials` model). ADOPTED: the live row whose `credential_name`
 * equals it. ⛔ A RENAMED ROW IS A DIFFERENT CREDENTIAL: the name is the only address the vendor's
 * routes have, so a changed `credentialName` plans a REPLACE — the old row survives under the
 * resource's default `retain` policy, never renamed in place.
 */
export interface CredentialProps {
  readonly credentialName: string;

  /**
   * Free-form metadata stored beside the values (`credential_info` in the vendor's row), compared
   * per DECLARED key with canonical-JSON deep equality. ⛔ Refused for a key matching the vendor's
   * own sensitive-key list: those belong in `credentialValues`, where LiteLLM stores them
   * encrypted and answers them masked — in `credential_info` they would be stored in clear.
   */
  readonly credentialInfo?: Readonly<Record<string, unknown>>;

  /**
   * The credential's values, each declared as `{ fromEnv: 'NAME' }` naming the environment
   * variable the DEPLOYING process reads at call time. AT LEAST ONE is required: LiteLLM's create
   * model refuses a body whose `credential_values` and `model_id` are both empty
   * (`models/credentials.py`'s `CreateCredentialItem` validator → 422), and `model_id` — which
   * would copy a deployment's values — is not modelled here, so a value-less declaration has
   * nothing to write. A value that never resolves in a plan-only environment never drifts
   * (credential-values.ts); one that resolves is SENT as the literal the proxy stores encrypted.
   */
  readonly credentialValues: Readonly<Record<string, FromEnv>>;
}

export interface CredentialAttributes {
  readonly credentialName: string;

  /**
   * The row's `credential_info` as the read answers it, minus any SENSITIVE-KEYED entry — those
   * would mirror a clear secret into Alchemy's state and are skipped (`toAttributes`). The digest
   * comparison ignores undeclared live keys (credential-form.ts).
   */
  readonly credentialInfo: Readonly<Record<string, unknown>>;

  /**
   * `scrypt:<salt>:<digest>` of the values the LAST WRITE resolved — the only way a plan notices
   * a rotated credential, because the live row answers masked fragments that can never be
   * compared (`secrets/write-only.ts`). An ADOPTED row starts `''`, which reads as `stale`.
   */
  readonly valuesSeal: string;
}

/**
 * Whether a value is not a string with something in it. Takes `unknown`: a declaration can say
 * anything. (Same rule as model-types.ts and registry-support.ts.)
 */
export const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

/**
 * The vendor's OWN sensitive-key list, read from the live 1.103.0 container
 * (`litellm_logging.py::_get_masked_values`): a key containing any of these substrings
 * (case-insensitive) is masked in every `credential_values` read. Credential-form.ts refuses
 * them in `credentialInfo` for the same reason the vendor masks them in values.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  'authorization',
  'token',
  'key',
  'secret',
  'vertex_credentials',
  'credentials',
  'password',
  'passwd',
];

/** Whether a key is one the vendor itself treats as sensitive. */
export const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
};
