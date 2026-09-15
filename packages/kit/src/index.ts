/**
 * @homeflare/kit — the estate's shared primitives.
 *
 * ⛔ THIS ENTRYPOINT STAYS RUNTIME-NEUTRAL. Bun is how the kit is authored, built and
 *   tested; it is not what consumers run. The monorepo ships this code to Cloudflare
 *   Workers, so anything reaching for `bun:*`, `node:fs` or a filesystem belongs behind
 *   its own subpath export (`@homeflare/kit/<area>`), never here.
 *   The failure this prevents is a deploy-time one: a `bun:sqlite` import that resolves
 *   fine on a laptop and fails only in workerd, where the stack trace names the bundler
 *   rather than this file.
 *
 * ★ isolatedDeclarations is on, so every exported symbol below carries an explicit
 *   return type. That is not style — `bun build` cannot emit .d.ts, so declarations come
 *   from a separate tsc pass, and explicit types are what keep the two in agreement.
 */

export { VERSION } from './version.ts';
export { EnvError, parseEnv, type EnvSchema, type EnvSpec } from './env.ts';
export { client, http, HTTPError, TimeoutError, type KyInstance, type Options } from './http.ts';
