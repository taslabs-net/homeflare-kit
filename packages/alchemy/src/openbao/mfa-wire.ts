/**
 * The OpenBao calls behind login MFA: TOTP methods under identity/mfa/method/totp, login
 * enforcements under identity/mfa/login-enforcement/<name>, and the auth table that turns a mount
 * path into the accessor an enforcement names.
 *
 * ★ OpenBao 2.6.2 SHIPS LOGIN MFA — confirmed in source before any of this was written:
 *   vault/identity/store.go:312-800 (mfaPaths) registers `mfa/method/totp`, `mfa/login-enforcement/
 *   <name>` and their listings on the identity backend; vault/identity/mfa.go holds the handlers
 *   and vault/login_mfa.go the storage.
 * ★ A TOTP METHOD IS FOUND BY NAME, NOT ID. The id is a server-made UUID; `method_name` is the only
 *   thing a declaration can know. An update without `method_id` UPSERTS by name within the request's
 *   namespace (identity/mfa.go:159-230, MemDBMFAConfigByName keys on namespace + name), so the same
 *   write both creates and updates. The listing (`key_info`, one entry per id, :63-69) answers the
 *   methods of this namespace AND its parents (login_mfa.go:652-713), so the match also requires
 *   this namespace's `namespace_path`.
 * ⚠️ AN UPDATE BY A STALE `method_id` IS A SILENT NO-OP: the handler returns nil for an unknown id
 *   (identity/mfa.go:172-183), which HTTP answers 204. So this never writes by id.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { BaoEnv, baoCall, baoDelete, baoRead } from './bao-http.ts';
import { envNamespace, namespacePath } from './bao-namespace.ts';
import type { BaoError } from './bao-status.ts';
import { mountPath } from './mount-form.ts';

export const TOTP_PATH = 'identity/mfa/method/totp';
export const enforcementPath = (name: string): string => `identity/mfa/login-enforcement/${name}`;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** This call's namespace as OpenBao writes `namespace_path`: `''` or `team-a/`. */
export const ownNamespacePath: Effect.Effect<string> = Effect.gen(function* () {
  const env = yield* BaoEnv;
  return namespacePath(envNamespace(env));
});

export type TotpEntry = { readonly id: string; readonly live: Record<string, unknown> };

/** The TOTP method named `name` in this namespace, or undefined. */
export const findTotp = (
  name: string,
): Effect.Effect<TotpEntry | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const listing = yield* baoRead(`${TOTP_PATH}?list=true`);
    const info = record(listing?.['key_info']) ?? {};
    const own = yield* ownNamespacePath;
    for (const [id, raw] of Object.entries(info)) {
      const live = record(raw);
      if (live === undefined) continue;
      if (live['name'] === name && live['type'] === 'totp' && live['namespace_path'] === own) {
        return { id, live };
      }
    }
    return undefined;
  });

/** Create-or-update by `method_name` — never by id (the ⚠️ above). */
export const writeTotp = (body: Readonly<Record<string, unknown>>) =>
  Effect.asVoid(baoCall('write', 'POST', TOTP_PATH, body));

/**
 * ⛔ DESTROYS EVERY ENTITY'S ENROLLED SECRET FOR THIS METHOD (login_mfa.go:1965-1973 clears the TOTP
 *   keys under the method id). OpenBao refuses it while an enforcement in memory still names the id
 *   (:1914-1924) — a refusal this passes on.
 */
export const deleteTotp = (id: string) => baoDelete(`${TOTP_PATH}/${id}`);

export const readEnforcement = (name: string) => baoRead(enforcementPath(name));

export const writeEnforcement = (name: string, body: Readonly<Record<string, unknown>>) =>
  Effect.asVoid(baoCall('write', 'POST', enforcementPath(name), body));

/**
 * Accessors for auth mount paths, from `GET sys/auth` (keys are `<path>/`). A path with no mount
 * comes back in `missing`, never as a guess.
 */
export const authAccessors = (
  paths: readonly string[],
): Effect.Effect<
  { readonly accessors: readonly string[]; readonly missing: readonly string[] },
  BaoError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    if (paths.length === 0) return { accessors: [], missing: [] };
    const table = (yield* baoRead('sys/auth')) ?? {};
    const accessors: string[] = [];
    const missing: string[] = [];
    for (const path of paths) {
      const accessor = record(table[`${mountPath(path)}/`])?.['accessor'];
      if (typeof accessor === 'string' && accessor !== '') accessors.push(accessor);
      else missing.push(mountPath(path));
    }
    return { accessors, missing };
  });
