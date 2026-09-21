/**
 * AppRole login and self-revoke for a plain Bun script — the one part of the openbao subpath that is
 * not a Resource.
 *
 * ★ WHY IT LIVES HERE. Wrapper scripts log in with a per-host AppRole and revoke the token on exit.
 *   Each one hand-rolling a `fetch` is how two of them end up disagreeing about BAO_ADDR versus
 *   BAO_AGENT_ADDR, or dropping the namespace header. This rides the transport every Bao.* family
 *   already uses: bao-address.ts resolution (BAO_ADDR, BAO_AGENT_ADDR, BAO_NAMESPACE, the VAULT_*
 *   twins, unix sockets), bao-http.ts's in-flight gate, timeout, transport retry and token
 *   redaction on spans, and bao-status.ts's status-first classification of the answer.
 * ★ ONE IMPLEMENTATION, TWO SHAPES. `appRoleLoginEffect` and `revokeSelfEffect` are the
 *   implementation; `appRoleLogin` and `revokeSelf` run them on the fetch client for a caller with
 *   no Effect runtime. Both fail with BaoLoginError and nothing else.
 *
 * ⚠️ SHARING A secret_id ACROSS HOSTS THROUGH A CACHING PROXY SHARES THE TOKEN. Two hosts sending
 *   the same AppRole login through a caching OpenBao Proxy get the SAME cached token back, so two
 *   hosts become one identity in every audit line (recorded as a trap in the 2026-09-21 vault
 *   consolidation plan; not re-measured here). Give each host its own secret_id.
 */
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { BaoEnvironment } from './bao-address.ts';
import { BaoEnv, baoCall } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';
import {
  BaoLoginError,
  failureOf,
  loginPath,
  mountProblem,
  redact,
  refusal,
} from './approle-login-form.ts';
import { type AppRoleLogin, loginOf } from './approle-login-result.ts';

export type { BaoLoginFailure } from './approle-login-form.ts';
export type { AppRoleLogin } from './approle-login-result.ts';
export { BaoLoginError };

export interface AppRoleLoginInput {
  /** The role_id. Not a secret on its own, but half of one — it is redacted from errors too. */
  readonly roleId: string;
  /** ⛔ The secret_id. Never logged, never in an error — see `redact`. */
  readonly secretId: string;
  /** The AppRole auth mount, e.g. `approle` (the default) — no `.`/`..` segments, `?` or `#`. */
  readonly mount?: string;
}

const LOGIN = 'OpenBao AppRole login';
const REVOKE = 'OpenBao revoke-self';

const failed =
  (operation: string, secrets: readonly string[]) =>
  (error: BaoError): BaoLoginError =>
    new BaoLoginError(
      failureOf(error.status),
      error.status,
      redact(error.errors, secrets),
      operation,
    );

/**
 * Log in with a role_id and secret_id, under BaoEnv (process.env unless a caller provides one).
 *
 * ⛔ THE LOGIN SENDS NO TOKEN, WHATEVER THE ENVIRONMENT HOLDS. BAO_TOKEN is overridden with a
 *   PRESENT-BUT-EMPTY value for this one call, which bao-address.ts readBaoVariable treats as
 *   winning over VAULT_TOKEN, so headersFor omits X-Vault-Token entirely. A script that already
 *   had an operator token exported must not send it along with a machine login.
 * ⚠️ A DROPPED TRANSPORT IS RETRIED TWICE (bao-http.ts retryTransport, status 0 only). If the first
 *   request reached OpenBao and only the answer was lost, the retry is a second login: one extra
 *   token that lives until its TTL, and — for a secret_id with `secret_id_num_uses` — one extra use.
 *   A single-use secret_id can therefore come back "invalid" on a flaky path.
 * ★ `PUT`, THE METHOD api/logical.go:325 WriteWithContext SENDS, which is what the official Go helper
 *   calls (api/auth/approle/approle.go:146). The docs show POST; both are the update operation.
 */
export const appRoleLoginEffect = (
  input: AppRoleLoginInput,
): Effect.Effect<AppRoleLogin, BaoLoginError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const problems = [
      refusal('roleId', input.roleId),
      refusal('secretId', input.secretId),
      mountProblem(input.mount),
    ].filter((problem): problem is string => problem !== undefined);
    if (problems.length > 0)
      return yield* Effect.fail(new BaoLoginError('input', 0, problems, LOGIN));
    const env = yield* BaoEnv;
    const body = yield* baoCall('write', 'PUT', loginPath(input.mount), {
      role_id: input.roleId,
      secret_id: input.secretId,
    }).pipe(
      Effect.provideService(BaoEnv, { ...env, BAO_TOKEN: '' }),
      Effect.mapError(failed(LOGIN, [input.roleId, input.secretId])),
    );
    const read = loginOf(body);
    if ('problem' in read) {
      return yield* Effect.fail(new BaoLoginError('response', 0, [read.problem], LOGIN));
    }
    return read.login;
  });

/**
 * Revoke `token` itself — what a wrapper runs on exit, so a login does not outlive its job.
 *
 * ★ `PUT auth/token/revoke-self`, READ FROM openbao v2.6.2 api/auth_token.go:318-330: the token
 *   revoked is the one in X-Vault-Token, and the body is empty. `token` rides in that header for
 *   this call only (BAO_TOKEN is overridden), whatever the environment holds.
 * ⚠️ AN ALREADY-REVOKED OR EXPIRED TOKEN IS A FAILURE, NOT A NO-OP. OpenBao refuses a token it no
 *   longer knows (permission denied — not measured here), and a refusal from the wrong server looks
 *   the same; "I could not tell" stays an error. A wrapper that only wants best-effort cleanup on
 *   exit can catch BaoLoginError with reason `refused`.
 * ⚠️ NEVER THROUGH AN AGENT OR PROXY IN `use_auto_auth_token = "force"` MODE. Force overwrites the
 *   request's token with the agent's own (bao-address.ts headersFor cites apiproxy.mdx), so this
 *   would revoke the AGENT's token. The estate's LAN proxy runs with no auto-auth at all.
 */
export const revokeSelfEffect = (
  token: string,
): Effect.Effect<void, BaoLoginError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const problem = refusal('token', token);
    if (problem !== undefined) {
      return yield* Effect.fail(new BaoLoginError('input', 0, [problem], REVOKE));
    }
    const env = yield* BaoEnv;
    yield* baoCall('write', 'PUT', 'auth/token/revoke-self').pipe(
      Effect.provideService(BaoEnv, { ...env, BAO_TOKEN: token }),
      Effect.mapError(failed(REVOKE, [token])),
    );
  });

/**
 * ★ `Effect.runPromise` REJECTS WITH THE FAILURE ITSELF on this Effect line (measured on
 *   effect 4.0.0-rc.115: the rejection is `instanceof` the failed class), so a script catches
 *   BaoLoginError directly.
 */
const runWith = <A>(
  env: BaoEnvironment | undefined,
  effect: Effect.Effect<A, BaoLoginError, HttpClient.HttpClient>,
): Promise<A> => {
  const scoped = env === undefined ? effect : Effect.provideService(effect, BaoEnv, env);
  return Effect.runPromise(scoped.pipe(Effect.provide(FetchHttpClient.layer)));
};

/**
 * `appRoleLoginEffect` for a plain script. `env` defaults to `process.env`, read at call time.
 *
 *     const login = await appRoleLogin({ roleId, secretId });
 *     try { … login.clientToken … } finally { await revokeSelf(login.clientToken); }
 */
export const appRoleLogin = (
  input: AppRoleLoginInput & { readonly env?: BaoEnvironment },
): Promise<AppRoleLogin> => runWith(input.env, appRoleLoginEffect(input));

/** `revokeSelfEffect` for a plain script. `env` defaults to `process.env`, read at call time. */
export const revokeSelf = (token: string, env?: BaoEnvironment): Promise<void> =>
  runWith(env, revokeSelfEffect(token));
