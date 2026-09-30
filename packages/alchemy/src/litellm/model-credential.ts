/**
 * The seal of a `LiteLLM.Model`'s declared `litellm_params` — the one way a plan notices a changed
 * `model`, `apiBase` or `apiKey` when the live row hides them.
 *
 * ★ REFERENCE-ONLY, AND THEREFORE PURE. The credential this resource declares is LiteLLM's own
 *   `os.environ/NAME` reference: the PROXY resolves the variable in ITS environment at inference
 *   time, and neither the row it writes nor the wire body ever carries the value. So this module
 *   never reads `process.env` — there is no value here to read, and a digest of a value that lives
 *   on another host would be false drift on every plan whose deploying environment differed.
 * ⛔ THE SEAL COVERS THE DECLARED VALUES ONLY. LiteLLM stores `litellm_params` encrypted and
 *   answers a row whose sensitive fields are omitted (model-types.ts), so the live row can never
 *   contribute to this comparison: attributes carry the digest of what was DECLARED, `paramsSeal`,
 *   and a plan that changes any of `model`, `apiBase` or the variable behind `apiKey` sees the
 *   digest change and updates. What was last written is remembered exactly; a row whose params the
 *   proxy hides stays quiet because the comparison never involves them.
 * ⛔ ADOPTED OR FOREIGN ROWS START `paramsSeal: ''` (a row cannot supply a digest of values it
 *   hides), which reads as `stale`. A bare adopt of a visibly matching row records the digest
 *   locally with no write; a stale seal on a declaration that manages a param the read never
 *   shows (`api_key`, `api_base`) forces one stamping POST, so a different stored reference is
 *   never sealed over. After that the seal is stable. `seals/write-only.ts` carries the scrypt
 *   rules; see also mcp-server-credential.ts for the credential that LiteLLM STORES (this one is
 *   only referenced).
 */
import { seal, sealMatches } from '../secrets/write-only.ts';
import type { ModelProps } from './model-types.ts';

/**
 * The declared `litellm_params` as the reference form names them — the input to the seal. `model`
 * and `api_base` are what the proxy routes on; `api_key` is the reference LiteLLM resolves in its
 * own environment. No value, ever: there is no lookup and no environment here.
 */
export const declaredValues = (props: ModelProps): Record<string, string> => {
  const values: Record<string, string> = { model: props.model };
  if (props.apiBase !== undefined) values['api_base'] = props.apiBase;
  if (props.apiKey !== undefined) values['api_key'] = `os.environ/${props.apiKey.fromEnv}`;
  return values;
};

/** `scrypt:<salt>:<digest>` of declared values, for `paramsSeal`. ⛔ Never a secret value. */
export const sealFromValues = (values: Record<string, string>): string => seal(values);

/** Whether the declaration's values are the ones `sealed` was made from. */
export const sealState = (props: ModelProps, sealed: string): 'match' | 'stale' =>
  sealMatches(sealed, declaredValues(props)) ? 'match' : 'stale';
