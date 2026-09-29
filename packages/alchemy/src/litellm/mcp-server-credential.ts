/**
 * The credential of a `LiteLLM.MCPServer`: resolved from the deploying process's environment,
 * held as `Redacted`, sealed, and compared by seal.
 *
 * ★ `Redacted` IS THE IN-MEMORY WRAPPER, NOT THE STORAGE FORMAT. Inside this process the value is a
 *   `Redacted<string>`, so a stray `console.log`, `JSON.stringify` or error dump prints
 *   `<redacted>`. It is unwrapped in exactly one place: the wire body (`mcp-server-form.ts`). It is
 *   never a prop or an attribute — see mcp-server-types.ts for why `Redacted` cannot be either.
 * ⚠️ LITELLM DOES NOT HAND A CREDENTIAL BACK TO COMPARE WITH (UNMEASURED at 1.103.0; the resource
 *   never relies on it). So what was last written is remembered as a SEAL, and a plan asks "is the
 *   value in my environment the one I wrote". Four answers:
 *   - `none`    — no credential is declared, nothing to compare.
 *   - `unknown` — the variable is unset here, so a plan cannot tell. Never drift: a plan-only
 *                 environment must not report every credentialed server as changed. (A write that
 *                 CHANGES `auth_type` is the exception: it demands the value, `requireCredential`.)
 *   - `stale`   — the variable is set and there is no seal (an adopted row, or one written outside
 *                 this stack) or the seal disagrees. The declaration is authoritative, so it is written.
 *   - `match`   — the seal was made from this value.
 * ⚠️ A SEAL OF A GUESSABLE SECRET IS STILL GUESSABLE (secrets/write-only.ts). Use a random token.
 */
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { type Environment, resolveAll, seal, sealMatches } from '../secrets/write-only.ts';
import { LitellmMcpServerCredentialEnvUnsetError } from './mcp-server-errors.ts';
import { type McpServerProps, isStaticAuthType } from './mcp-server-types.ts';

/** What the environment holds for the declared credential. `value` is undefined when unset or empty. */
export interface ResolvedCredential {
  /** The variable's NAME, for a message. `undefined` when no credential is declared. */
  readonly variable: string | undefined;
  readonly value: Redacted.Redacted<string> | undefined;
}

export type CredentialState = 'none' | 'unknown' | 'stale' | 'match';

/** ⛔ Reads the environment at CALL time, never at module load (docs/credentials.md). */
export const resolveCredential = (
  props: McpServerProps,
  env: Environment = process.env,
): ResolvedCredential => {
  if (props.authValue === undefined) return { value: undefined, variable: undefined };
  const { values } = resolveAll({ authValue: props.authValue }, env);
  const raw = values['authValue'];
  return {
    value: raw === undefined ? undefined : Redacted.make(raw),
    variable: props.authValue.fromEnv,
  };
};

const sealable = (value: Redacted.Redacted<string>) => ({ authValue: Redacted.value(value) });

/** `scrypt:<salt>:<digest>` of a credential, for `credentialSeal`. ⛔ Never the value. */
export const sealCredential = (value: Redacted.Redacted<string>): string => seal(sealable(value));

export const credentialState = (
  props: McpServerProps,
  sealed: string,
  resolved: ResolvedCredential = resolveCredential(props),
): CredentialState => {
  if (props.authValue === undefined || !isStaticAuthType(props.authType)) return 'none';
  if (resolved.value === undefined) return 'unknown';
  if (sealed === '') return 'stale';
  return sealMatches(sealed, sealable(resolved.value)) ? 'match' : 'stale';
};

/**
 * Fails naming the variable when this write has to send a static credential and the deploying
 * process does not hold it. Passes for a type that carries none.
 *
 * ⛔ A WRITE THAT CHANGES `auth_type` MUST SEND THE CREDENTIAL, exactly like a create. Measured on
 *   the live 1.103.0 container (`mcp_server/db.py` lines 1013-1014, `_credential_auth_class`): an
 *   edit whose auth class differs from the stored one and that sends no `credentials` key WIPES the
 *   stored credential, and each static type is its own class. Sent without the credential, the row
 *   would end with none while the seal still matched the old value, so a later deploy with the
 *   variable set would be a no-op and the server would stay unauthenticated until the secret rotated.
 */
export const requireCredential = (props: McpServerProps, credential: ResolvedCredential) =>
  isStaticAuthType(props.authType) && credential.value === undefined
    ? Effect.fail(
        new LitellmMcpServerCredentialEnvUnsetError({
          serverName: props.serverName,
          variable: credential.variable ?? '(undeclared)',
        }),
      )
    : Effect.void;
