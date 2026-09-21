/**
 * What a successful AppRole login hands back, and how it is read out of a 2xx body. Split from
 * approle-login-form.ts, which decides what goes IN; this decides what comes OUT and how the token
 * stays out of every log line that prints the result.
 *
 * ★ READ FROM openbao v2.6.2 api/secret.go:304-318 SecretAuth — `client_token`, `accessor`,
 *   `policies`, `lease_duration` and `mfa_requirement`. (api/*.go cited here diffed identical
 *   between v2.6.0 and v2.6.2.)
 */

/** What a successful login hands back. */
export interface AppRoleLogin {
  /**
   * The token. ⛔ A GETTER OVER A PRIVATE FIELD, NEVER AN OWN PROPERTY — see LoginResult below.
   * `console.log(login)` prints `clientToken: [Getter]` at most, and `JSON.stringify(login)`,
   * `{ ...login }` and `structuredClone(login)` carry no token at all. Read it by name.
   */
  readonly clientToken: string;
  /** The token's accessor — safe to log, and what revoke-accessor and audit lines name. */
  readonly accessor: string;
  /** Every policy on the token: the role's token_policies plus identity policies. */
  readonly policies: readonly string[];
  /** The token TTL in seconds, from the role's `token_ttl`. */
  readonly leaseDurationSeconds: number;
}

/**
 * ⛔ A PRIVATE FIELD BEHIND A PROTOTYPE GETTER, BECAUSE A NON-ENUMERABLE PROPERTY DID NOT HIDE THE
 *   TOKEN UNDER BUN. MEASURED 2026-09-21 on bun 1.4.0: `console.log` of an object whose token was a
 *   non-enumerable OWN property printed `clientToken: "<the token>"` in full — node's util.inspect
 *   hid it, bun's formatter did not — and this helper exists for Bun scripts. The first version
 *   shipped exactly that shape, with a test that checked JSON and Object.keys but never a print.
 *   This shape prints `clientToken: [Getter]` under bun's console.log and Bun.inspect, and nothing
 *   at all under node's default inspect.
 * ⚠️ `util.inspect(login, { getters: true })` DOES evaluate the getter. That is an explicit request
 *   for the value, not an accident of logging the result.
 */
class LoginResult implements AppRoleLogin {
  readonly #token: string;
  readonly accessor: string;
  readonly policies: readonly string[];
  readonly leaseDurationSeconds: number;

  constructor(token: string, accessor: string, policies: readonly string[], lease: number) {
    this.#token = token;
    this.accessor = accessor;
    this.policies = Object.freeze([...policies]);
    this.leaseDurationSeconds = lease;
    Object.freeze(this);
  }

  get clientToken(): string {
    return this.#token;
  }
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * The login in a 2xx body, or the reason there is none.
 *
 * ⚠️ AN EMPTY `client_token` WITH A `mfa_requirement` IS AN UNFINISHED LOGIN, NOT A BROKEN ONE. The
 *   auth block carries that field for a login that still owes an MFA step (api/secret.go:317). A
 *   script cannot complete that step, so it is named rather than reported as a missing field.
 *   REASONED FROM THE CLIENT TYPE — no MFA-enforced login was run.
 * ⛔ THE BODY IS NEVER QUOTED. It holds the token on success and is not OpenBao's on a wrong address.
 */
export const loginOf = (
  body: Record<string, unknown> | undefined,
): { readonly login: AppRoleLogin } | { readonly problem: string } => {
  const auth = body?.['auth'];
  if (typeof auth !== 'object' || auth === null || Array.isArray(auth)) {
    return { problem: 'the answer carried no auth block' };
  }
  const fields = auth as Record<string, unknown>;
  const token = fields['client_token'];
  if (typeof token !== 'string' || token === '') {
    const mfa = fields['mfa_requirement'];
    return {
      problem:
        mfa !== undefined && mfa !== null
          ? 'the login requires MFA, which this helper does not complete'
          : 'the auth block carried no client_token',
    };
  }
  const lease = fields['lease_duration'];
  return {
    login: new LoginResult(
      token,
      typeof fields['accessor'] === 'string' ? fields['accessor'] : '',
      strings(fields['policies']),
      typeof lease === 'number' && Number.isFinite(lease) ? lease : 0,
    ),
  };
};
