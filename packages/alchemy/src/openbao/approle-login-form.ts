/**
 * The pure half of an AppRole login's INPUT and FAILURE: what counts as a usable input, and how a
 * failure is described without the credential in it. Split from approle-login.ts so each decision
 * is testable without a server; what a success hands back is approle-login-result.ts.
 *
 * ★ READ FROM openbao v2.6.2, NOT RECALLED:
 *   · docs/api/auth/approle.mdx "Login with AppRole" — `role_id` and `secret_id` in, an `auth` block
 *     out.
 *   · api/auth/approle/approle.go:145-146 — the official Go helper writes `auth/<mount>/login`, and
 *     the mount is `approle` unless the caller says otherwise. (api/*.go cited here diffed identical
 *     between v2.6.0 and v2.6.2.)
 */
import { trimSlashes } from './mount-path.ts';

/** Why a login or a revoke failed. */
export type BaoLoginFailure =
  /** Refused before any request was sent: an empty or padded value, or a mount that is not a path. */
  | 'input'
  /** OpenBao (or something at BAO_ADDR) answered with a non-2xx status. */
  | 'refused'
  /** No answer at all — transport, timeout, or an address nothing listens on. */
  | 'unreachable'
  /** A 2xx that is not a usable answer: not JSON, no auth block, or MFA still required. */
  | 'response';

/**
 * The failure a transport-level BaoError stands for.
 *
 * ⚠️ A 2xx CAN FAIL TOO, AND IT IS NOT A REFUSAL. bao-status.ts settle fails a success whose body is
 *   not a JSON object — the shape of a BAO_ADDR that points at some other web server. The first
 *   version mapped every non-zero status to `refused`, so that read as `refused 200`: a server that
 *   said yes, reported as one that said no.
 */
export const failureOf = (status: number): BaoLoginFailure =>
  status === 0 ? 'unreachable' : status >= 200 && status < 300 ? 'response' : 'refused';

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
    /** The HTTP status, or 0 when none applies (input, unreachable, an unusable auth block). */
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
export const loginMount = (mount: string | undefined): string => trimSlashes(mount ?? 'approle');

/**
 * Why `mount` cannot name an auth mount, or undefined when it can.
 *
 * ⛔ THE MOUNT IS SPLICED INTO A URL, AND THE URL PARSER RESOLVES `..` AND ENDS THE PATH AT `?` OR
 *   `#`. `new URL('…/v1/auth/../sys/x/login')` is `…/v1/sys/x/login` — the role_id and secret_id
 *   would be sent to a path the caller never named. Refused rather than escaped, like padding.
 */
export const mountProblem = (mount: string | undefined): string | undefined => {
  const path = loginMount(mount);
  if (path === '') return 'mount is empty';
  const segments = path.split('/');
  if (
    /[\s?#%\\]/.test(path) ||
    segments.some((part) => part === '' || part === '.' || part === '..')
  ) {
    return `mount ${JSON.stringify(path)} is not a plain mount path`;
  }
  return undefined;
};

/** `auth/<mount>/login` — what api/auth/approle/approle.go:145 writes. */
export const loginPath = (mount: string | undefined): string => `auth/${loginMount(mount)}/login`;

/** strconv.Quote's single-letter escapes, by code point. */
const GO_ESCAPES: Readonly<Record<number, string>> = {
  7: 'a',
  8: 'b',
  9: 't',
  10: 'n',
  11: 'v',
  12: 'f',
  13: 'r',
};

/**
 * `value` as it appears between the quotes of Go's `%q` (strconv.Quote) — ASCII escapes only.
 * ⚠️ Non-ASCII passes through as-is, which is what strconv.Quote does for PRINTABLE runes; a
 *   non-printable non-ASCII rune in a secret would escape differently and is not covered.
 */
const goQuoted = (value: string): string =>
  [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      const named = GO_ESCAPES[code];
      if (char === '"' || char === '\\') return `\\${char}`;
      if (named !== undefined) return `\\${named}`;
      if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, '0')}`;
      return char;
    })
    .join('');

/**
 * Every string in `errors` with each credential replaced by `[redacted]`.
 *
 * ⛔ OPENBAO CAN ECHO THE SECRET_ID BACK, SO THIS IS NOT DEFENCE IN DEPTH — IT IS THE DEFENCE.
 *   openbao v2.6.2 builtin/credential/approle/path_login.go:291 answers a limited-use secret_id
 *   whose storage entry vanished between two reads with `invalid secret_id "<the secret_id>"`.
 *   BaoError keeps OpenBao's `errors` verbatim (that is its job), so every string that leaves the
 *   login or revoke passes through here first.
 * ⚠️ THAT ECHO IS `%q`, SO THE RAW VALUE IS NOT ENOUGH. A custom secret_id holding `"` or `\` comes
 *   back escaped (`\"`, `\\`) and would slip past a raw match; the Go-quoted form is redacted too.
 * ⚠️ LONGEST FIRST. Were one value a substring of another, redacting the shorter first would break
 *   the longer one's match and leave the rest of it in the message.
 */
export const redact = (
  errors: readonly string[],
  secrets: readonly string[],
): readonly string[] => {
  const forms = [...new Set(secrets.flatMap((secret) => [secret, goQuoted(secret)]))]
    .filter((form) => form !== '')
    .sort((a, b) => b.length - a.length);
  return errors.map((entry) =>
    forms.reduce((text, form) => text.split(form).join('[redacted]'), entry),
  );
};
