/**
 * The values of a `LiteLLM.Credential` — resolved from the deploying process's environment at
 * call time, held as `Redacted`, and compared by seal.
 *
 * ★ THIS IS THE CREDENTIAL LITELLM STORES, so the deploying process holds the value: the wire
 *   body carries the LITERAL (the proxy encrypts it into its database, measured in the live
 *   1.103.0 container — `credential_endpoints/endpoints.py`'s `encrypt_credential_values`), which
 *   is exactly why the prop is only a NAME (`credential-types.ts`). Inside this process the value
 *   is a `Redacted<string>`, so a stray log or error dump prints `<redacted>`; it is unwrapped in
 *   exactly one place, the wire body (credential-form.ts). Never a prop or an attribute.
 * ⚠️ LITELLM DOES NOT HAND THE VALUES BACK TO COMPARE WITH: both reads answer them MASKED
 *   (2 + `****` + 2, `*****` for a short string — `litellm_logging.py::_get_masked_values`), and a
 *   masked fragment is a partial secret that must never be compared or stored. So what was last
 *   written is remembered as a SEAL, and a plan asks "are the values in my environment the ones I
 *   wrote". Four answers, mcp-server-credential.ts's own list:
 *   - `none`    — no values are declared, nothing to compare.
 *   - `unknown` — one or more declared variables is unset here, so a plan cannot tell. Never
 *                 drift: a plan-only environment must not report every credentialed row as
 *                 changed. A WRITE still demands them (`requireValues`).
 *   - `stale`   — every variable is set and there is no seal (an adopted row, or one written
 *                 outside this stack) or the seal disagrees. The declaration is authoritative,
 *                 so it is written.
 *   - `match`   — the seal was made from exactly these resolved values.
 * ⚠️ ALL-OR-NOTHING RESOLUTION: a write sends `credential_values` only when EVERY declared
 *   variable resolves — the values-stale PATCH and the whole-row create both demand every value
 *   (`requireValues`, credential.ts), because sending the resolved half would store a row whose
 *   unset half was silently blanked. When any variable is missing the state is `unknown`: an
 *   info-only PATCH can proceed, but a required rewrite refuses before DELETE.
 * ⚠️ A SEAL OF A GUESSABLE SECRET IS STILL GUESSABLE (secrets/write-only.ts). Use a random token.
 */
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { type Environment, resolveAll, seal, sealMatches } from '../secrets/write-only.ts';
import { LitellmCredentialEnvUnsetError } from './credential-errors.ts';
import type { CredentialProps } from './credential-types.ts';

/** What the environment holds for the declared values. `missing` names the unset variables. */
export interface ResolvedValues {
  readonly values: Readonly<Record<string, Redacted.Redacted<string>>>;
  readonly missing: readonly string[];
}

export type CredentialValuesState = 'none' | 'unknown' | 'stale' | 'match';

/** ⛔ Reads the environment at CALL time, never at module load (docs/credentials.md). */
export const resolveValues = (
  props: CredentialProps,
  env: Environment = process.env,
): ResolvedValues => {
  const { values, missing } = resolveAll(props.credentialValues, env);
  return {
    missing,
    values: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, Redacted.make(value)]),
    ),
  };
};

const sealable = (values: Readonly<Record<string, Redacted.Redacted<string>>>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Redacted.value(value)]));

/** `scrypt:<salt>:<digest>` of the resolved values, for `valuesSeal`. ⛔ Never a value. */
export const sealValues = (values: Readonly<Record<string, Redacted.Redacted<string>>>): string =>
  seal(sealable(values));

export const valuesState = (
  props: CredentialProps,
  sealed: string,
  resolved: ResolvedValues = resolveValues(props),
): CredentialValuesState => {
  const declared = Object.keys(props.credentialValues);
  if (declared.length === 0) return 'none';
  if (resolved.missing.length > 0) return 'unknown';
  if (sealed === '') return 'stale';
  return sealMatches(sealed, sealable(resolved.values)) ? 'match' : 'stale';
};

/**
 * Fails naming the missing variables when this write has to send the values and the deploying
 * process does not hold them all. Creates, rewrites and value-stale PATCHes need every value;
 * an info-only PATCH leaves values alone and does not need this guard (credential.ts).
 */
export const requireValues = (
  props: CredentialProps,
  resolved: ResolvedValues,
): Effect.Effect<void, LitellmCredentialEnvUnsetError> =>
  resolved.missing.length === 0
    ? Effect.void
    : Effect.fail(
        new LitellmCredentialEnvUnsetError({
          credentialName: props.credentialName,
          variables: resolved.missing,
        }),
      );
