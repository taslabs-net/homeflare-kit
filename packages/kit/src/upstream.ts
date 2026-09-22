/**
 * A client for ONE upstream API, carrying that upstream's quirks so no caller re-derives
 * them.
 *
 * ★ WHY THIS EXISTS ON TOP OF `client()`. Thirty hand-built clients across an MCP fleet
 *   each re-derived the same five things: read an env var, decide a base URL, assert a
 *   credential, issue the request, turn a bad status into an actionable error. Written
 *   thirty times, written thirty ways — and the divergence was not cosmetic.
 *
 * ★ ky IS THE TRANSPORT, NOT REPLACED. Retries, timeouts, `Retry-After` and jitter are
 *   ky's job and it does them well. This adds only what ky has no opinion about: where
 *   the URL and credential come from, which auth scheme this upstream wants, and what a
 *   given status means HERE.
 *
 * ⛔ READS ONLY. `upstream()` issues GET and nothing else. Every write-capable service
 *   should run with its OWN credential, so widening this must be a deliberate, separate
 *   act — see `writableUpstream()`. A `method` parameter would make that a one-word edit
 *   in a pull request nobody reviews closely.
 */
import type { KyInstance, Options } from 'ky';
import { isUnset } from './env.ts';
import { KitError } from './errors.ts';
import { client } from './http.ts';
import { rateLimitAware } from './rate-limit.ts';

export interface UpstreamConfig {
  /** Lowercase system name. Appears in every error this client raises. */
  readonly system: string;
  /** Env var holding the base URL, e.g. `GRAFANA_URL`. */
  readonly urlVar: string;
  /** Used when `urlVar` is unset. */
  readonly defaultUrl: string;
  /** Env var holding the credential. Omit for an upstream that needs none. */
  readonly tokenVar?: string;
  /**
   * How the credential becomes headers. Defaults to `Bearer`.
   * ⚠️ NOT EVERY UPSTREAM TAKES Bearer. Django REST Framework wants `Token <value>`, and
   *   measured, Bearer returns 401 there. A wrong SCHEME and a wrong CREDENTIAL are
   *   indistinguishable in the response, which is why this is config and not a guess.
   */
  readonly authHeader?: (token: string) => Record<string, string>;
  /** Prefix every path, e.g. Grafana documents its paths relative to `/api`. */
  readonly pathPrefix?: string;
  /** Say where the secret comes FROM. Appended to the "no credential" error. */
  readonly tokenRemedy?: string;
  /** Where the env lives. Defaults to `process.env`; pass a Worker's `env` binding. */
  readonly env?: Readonly<Record<string, unknown>>;
  /** Extra ky options — timeout, retry limits, headers. */
  readonly options?: Options;
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

function readEnv(config: UpstreamConfig, name: string): string {
  const source =
    config.env ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
    {};
  return String(source[name] ?? '').trim();
}

/**
 * ⛔ FAIL CLOSED ON A MISSING CREDENTIAL, AND SAY WHY. Omitting the header instead is
 *   worse: the upstream answers a bare 401, which is indistinguishable from a bad
 *   credential and sends an operator to rotate a perfectly good secret.
 * ⚠️ The remedy distinguishes the two ways this actually happens, because the fix differs:
 *   an EMPTY value means the secret did not render (a denied vault path writes nothing
 *   rather than erroring — check the grant, not whether the file exists), while "null"
 *   means the binding name does not match what the deployment writes.
 */
function credential(config: UpstreamConfig): string {
  if (config.tokenVar === undefined) return '';

  const value = readEnv(config, config.tokenVar);
  if (isUnset(value)) {
    throw new KitError('misconfigured', `no ${config.tokenVar} in the environment`, {
      system: config.system,
      remedy:
        `An EMPTY value means the secret did not render — a denied secret path does not ` +
        `error, it writes nothing, so check the grant rather than the file existing. ` +
        `"null" means the binding name does not match what the deployment writes. ${
          config.tokenRemedy ?? ''
        }`,
    });
  }
  return value;
}

/** The base URL, trailing slashes stripped so joining a path cannot double one. */
function baseUrl(config: UpstreamConfig): string {
  return (readEnv(config, config.urlVar) || config.defaultUrl).replace(/\/+$/, '');
}

/** ⚠️ Built per call, never captured: a Worker isolate is reused, so a value read at
 *   module scope pins whatever the first request happened to see. */
function optionsFor(config: UpstreamConfig): Options {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.tokenVar !== undefined) {
    Object.assign(headers, (config.authHeader ?? bearer)(credential(config)));
  }

  return {
    ...rateLimitAware,
    ...config.options,
    headers: { ...headers, ...config.options?.headers },
    // ⛔ NEVER FOLLOW A REDIRECT. An unauthenticated request is often answered with a 302
    //   to a login page; following it returns HTML with status 200, which reads as a
    //   broken API rather than as "you are not authenticated".
    // ⚠️ Django's APPEND_SLASH does the same for a slash-less path.
    redirect: 'manual',
  };
}

/** A read-only client for one upstream. ⛔ GET only — see the file header. */
export function upstream(config: UpstreamConfig): Pick<KyInstance, 'get'> {
  const prefix = config.pathPrefix ?? '';
  const instance = client(baseUrl(config), optionsFor(config));

  return {
    get: ((path: string, options?: Options) =>
      instance.get(`${prefix}${path}`, options)) as KyInstance['get'],
  };
}

/**
 * A client that may also write.
 *
 * ⛔ DELIBERATELY A SEPARATE FUNCTION, NOT A FLAG. A write-capable service should run
 *   with its own credential and its own deployment, so reaching for writes is a visible
 *   choice at the call site and in review — not a boolean somebody flipped.
 */
export function writableUpstream(config: UpstreamConfig): KyInstance {
  return client(`${baseUrl(config)}${config.pathPrefix ?? ''}`, optionsFor(config));
}
