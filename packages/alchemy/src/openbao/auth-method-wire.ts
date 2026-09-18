/**
 * The OpenBao calls Bao.AuthMethod makes — read one method, enable, tune, disable.
 *
 * ★ ENDPOINTS, READ FROM openbao v2.6.2 api/sys_auth.go — the client configure-engines
 *   used via curl:
 *     read     GET    sys/auth/<path>
 *     enable   POST   sys/auth/<path>        — `bao auth enable`
 *     tune     POST   sys/auth/<path>/tune   — `bao auth tune`
 *     disable  DELETE sys/auth/<path>        — `bao auth disable`
 *     table    GET    sys/auth
 */
import * as Effect from 'effect/Effect';
import {
  type BaoAuthMethodProps,
  authPath,
  enableBody,
  readPath,
  tuneBody,
  tunePath,
} from './auth-method-form.ts';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { BaoError } from './bao-status.ts';

/**
 * Confirm a method is absent from the auth table, or give back the error that asked.
 *
 * ⛔ A MISSING AUTH METHOD IS NOT A 404, IT IS A 400 — THE SAME TRAP AS SECRETS MOUNTS
 *   (mount-wire.ts). `handleReadAuth` answers an empty path with a bare error; the CLI
 *   therefore failed and never reached `auth enable`. REASONED FROM THE MOUNT ANALOG
 *   AND PINNED AGAINST A FAKE — a live missing-method read was not measured.
 * ★ SO A 400 IS SETTLED BY GET sys/auth. Only a 200 table WITHOUT the `${path}/` key
 *   is absence. A listed method, a refused listing, or a 404 listing leaves the 400.
 */
const absentFromTable = (path: string, asked: BaoError) =>
  baoRead('sys/auth').pipe(
    Effect.mapError(
      (listing) =>
        new BaoError(asked.status, asked.method, asked.path, [
          ...asked.errors,
          `sys/auth could not confirm the method is absent: ${listing.message}`,
        ]),
    ),
    Effect.flatMap((table) =>
      table !== undefined && !Object.hasOwn(table, `${authPath(path)}/`)
        ? Effect.succeed(undefined)
        : Effect.fail(asked),
    ),
  );

/** One method's config (`type`, `description`, `config.*_lease_ttl`), or undefined when absent. */
export const readAuthMethodData = (path: string) =>
  baoRead(readPath(path)).pipe(
    Effect.catchIf(
      (error) => error.status === 400,
      (error) => absentFromTable(path, error),
    ),
  );

export const enableAuthMethod = (props: BaoAuthMethodProps) =>
  baoWrite('POST', readPath(props.path), enableBody(props));

export const tuneAuthMethod = (props: BaoAuthMethodProps) =>
  baoWrite('POST', tunePath(props.path), tuneBody(props));

/** ⚠️ THERE IS NO FORCE. Disable is a plain DELETE, same as `bao auth disable`. */
export const disableAuthMethod = (path: string) => baoDelete(readPath(path));
