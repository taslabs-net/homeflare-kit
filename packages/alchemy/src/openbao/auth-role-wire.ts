/**
 * AppRole METADATA through the named SDK operations (OpenBao 2.6.2 generated schema).
 * ★ pathRoleRead returns nil for absence; logical.RespondErrorCommon turns that read into
 * 404. pathRoleDelete returns nil for an already absent role (204). Reasoned from v2.6.2
 * builtin/credential/approle/path_role.go:1758-1904 and sdk/logical/response_util.go:21-26.
 * ⛔ No role-id, secret-id or login request belongs in this configuration lifecycle.
 */
import {
  type AppRoleReadRoleResponse,
  type AppRoleWriteRoleRequest,
  appRoleDeleteRole,
  appRoleReadRole,
  appRoleWriteRole,
} from '@distilled.cloud/openbao/approle';
import * as Effect from 'effect/Effect';
import { type BaoAuthRoleProps, readPath } from './auth-role-form.ts';
import { BaoError } from './bao-status.ts';
import { runBao, runBaoRead } from './distilled.ts';
import { parseDuration } from './mount-form.ts';

const identity = (name: string) => ({ approle_mount_path: 'approle', role_name: name });
const seconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The vendor always returns these managed fields (pathRoleRead + tokenutil.PopulateTokenData).
 * Generated response fields are optional, so a proxy's 200 {} must not supply default values.
 * Ignore unmanaged fields: secret_id_bound_cidrs can legitimately be null in the vendor response.
 */
const completeRole = (live: AppRoleReadRoleResponse): boolean =>
  live !== null &&
  typeof live === 'object' &&
  typeof live.bind_secret_id === 'boolean' &&
  seconds(live.secret_id_num_uses) &&
  seconds(live.secret_id_ttl) &&
  seconds(live.token_ttl) &&
  seconds(live.token_max_ttl) &&
  Array.isArray(live.token_policies) &&
  live.token_policies.every((policy) => typeof policy === 'string');

export const readAuthRole = (name: string) =>
  runBaoRead(appRoleReadRole(identity(name))).pipe(
    Effect.flatMap((live) =>
      completeRole(live)
        ? Effect.succeed(live)
        : Effect.fail(new BaoError(200, 'GET', readPath(name), ['incomplete role metadata'])),
    ),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

export const authRoleExists = (name: string) =>
  readAuthRole(name).pipe(Effect.map((live) => live !== undefined));

export const authRoleRequest = (props: BaoAuthRoleProps) =>
  Effect.gen(function* () {
    const tokenTtl = parseDuration(props.tokenTtl);
    const tokenMaxTtl = parseDuration(props.tokenMaxTtl);
    const secretIdTtl = parseDuration(props.secretIdTtl);
    if (!seconds(tokenTtl) || !seconds(tokenMaxTtl) || !seconds(secretIdTtl)) {
      return yield* Effect.fail(
        new BaoError(0, 'POST', readPath(props.name), ['invalid role TTL duration']),
      );
    }
    // ★ The former CLI-style body used strings for every k=v. The SDK schema uses seconds,
    // booleans and arrays; omitted knobs stay omitted on update.
    // pathRoleCreateUpdate preserves absent bind_secret_id/secret_id_num_uses on existing roles.
    const request: AppRoleWriteRoleRequest = {
      ...identity(props.name),
      token_policies: [...props.tokenPolicies],
      token_ttl: tokenTtl,
      token_max_ttl: tokenMaxTtl,
      secret_id_ttl: secretIdTtl,
      ...(props.bindSecretId === undefined ? {} : { bind_secret_id: props.bindSecretId }),
      ...(props.secretIdNumUses === undefined ? {} : { secret_id_num_uses: props.secretIdNumUses }),
    };
    return request;
  });

export const writeAuthRole = (props: BaoAuthRoleProps) =>
  authRoleRequest(props).pipe(Effect.flatMap((request) => runBao(appRoleWriteRole(request))));

/** Other typed SDK failures, including denied deletes, propagate unchanged. */
export const deleteAuthRole = (name: string) =>
  runBao(appRoleDeleteRole(identity(name))).pipe(Effect.catchTag('NotFound', () => Effect.void));
