/**
 * The pure half of an AppRole login: what counts as a usable input, what counts as a usable answer,
 * and how a failure is described without the credential in it. Split from approle-login.ts so each
 * decision is testable without a server.
 *
 * ★ READ FROM openbao v2.6.2, NOT RECALLED:
 *   · docs/api/auth/approle.mdx "Login with AppRole" — `role_id` and `secret_id` in, an `auth` block
 *     out.
 *   · api/auth/approle/approle.go:145-146 — the official Go helper writes `auth/<mount>/login`, and
 *     the mount is `approle` unless the caller says otherwise.
 *   · api/secret.go:304-318 SecretAuth — `client_token`, `accessor`, `policies`, `lease_duration`,
 *     and `mfa_requirement`. (api/*.go cited here diffed identical between v2.6.0 and v2.6.2.)
 */

/** Why a login or a revoke failed. */
export type BaoLoginFailure =
  /** Refused before any request was sent: an empty or padded value. */
  | 'input'
  /** OpenBao (or something at BAO_ADDR) answered with a non-2xx status. */
  | 'refused'
  /** No answer at all — transport, timeout, or an address nothing listens on. */
  | 'unreachable'
  /** A 2xx whose body is not a usable login: no auth block, or MFA still required. */
  | 'response';

/**
 * A failed login or revoke.
 *
 * ⛔ IT NEVER CARRIES A CREDENTIAL. It is built from the operation name, a status and a list of
 *   strings that have been through `redact` — never from the request, a header, or a `cause`, for
 *   the reason bao-status.ts gives for BaoError.
 */
export class BaoLoginError extends Error {
  constructor(
    readonly reason: BaoLoginFailure,
    /** The HTTP status, or 0 when none applies (input, unreachable, response). */
    readonly status: number,
    readonly errors: readonly string[],
    operation: string,
  ) {
    const code = status === 0 ? reason : `${reason} ${String(status)}`;
    super(`${operation}: ${code}: ${errors.join('; ') || '(no errors given)'}`);
    this.name = 'BaoLoginError';
  }
}

/**
 * Why a value cannot be sent, or undefined when it can.
 *
 * ⚠️ PADDING IS REFUSED, NOT TRIMMED. `await Bun.file(path).text()` keeps a secret_id file's trailing
 *   newline, and OpenBao answers that with "invalid role or secret ID" — the same words it uses for
 *   a revoked or expired credential, so the real cause is invisible from the error. Trimming quietly
 *   would send a different value from the one the caller holds; refusing names the problem.
 * ⚠️ `unknown`, NOT `string`: a plain script passes `process.env.X`, which is `undefined` when unset.
 */
export const refusal = (label: string, value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return `${label} is empty`;
  if (value.trim() === '') return `${label} is only whitespace`;
  if (value.trim() !== value) {
    return `${label} has leading or trailing whitespace (a file read keeps its newline; trim it)`;
  }
  return undefined;
};

/** The auth mount without slashes; `approle` when the caller did not say. */
export const loginMount = (mount: string | undefined): string =>
  (mount ?? 'approle').replace(/^\/+|\/+$/g, '');

/** `auth/<mount>/login` — what api/auth/approle/approle.go:145 writes. */
export const loginPath = (mount: string | undefined): string => `auth/${loginMount(mount)}/login`;

/**
 * Every string in `errors` with each credential replaced by `[redacted]`.
 *
 * ⛔ OPENBAO CAN ECHO THE SECRET_ID BACK, SO THIS IS NOT DEFENCE IN DEPTH — IT IS THE DEFENCE.
 *   openbao v2.6.2 builtin/credential/approle/path_login.go:291 answers a limited-use secret_id
 *   whose storage entry vanished between two reads with `invalid secret_id "<the secret_id>"`.
 *   BaoError keeps OpenBao's `errors` verbatim (that is its job), so every string that leaves the
 *   login or revoke passes through here first.
 */
export const redact = (errors: readonly string[], secrets: readonly string[]): readonly string[] =>
  errors.map((entry) =>
    secrets.reduce(
      (text, secret) => (secret === '' ? text : text.split(secret).join('[redacted]')),
      entry,
    ),
  );

/** What a successful login hands back. */
export interface AppRoleLogin {
  /**
   * The token. ⛔ NON-ENUMERABLE: `console.log(login)` and `JSON.stringify(login)` leave it out, so
   * logging the result to see the policies cannot also log the credential.
   * ⚠️ So does a spread — `{ ...login }` has no token. Read the property by name.
   */
  readonly clientToken: string;
  /** The token's accessor — safe to log, and what revoke-accessor and audit lines name. */
  readonly accessor: string;
  /** Every policy on the token: the role's token_policies plus identity policies. */
  readonly policies: readonly string[];
  /** The token TTL in seconds, from the role's `token_ttl`. */
  readonly leaseDurationSeconds: number;
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
  const login = {
    accessor: typeof fields['accessor'] === 'string' ? fields['accessor'] : '',
    leaseDurationSeconds: typeof lease === 'number' && Number.isFinite(lease) ? lease : 0,
    policies: strings(fields['policies']),
  };
  Object.defineProperty(login, 'clientToken', { enumerable: false, value: token });
  return { login: Object.freeze(login) as AppRoleLogin };
};
