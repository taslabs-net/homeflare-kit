/**
 * The OpenBao calls Bao.Mount makes — read one mount, enable, tune, disable. Split from mount.ts so
 * the classification of a MISSING mount can be tested against a fake server.
 *
 * ★ ENDPOINTS, READ FROM openbao v2.6.2 api/sys_mounts.go — the client the CLI used:
 *     read     GET    sys/mounts/<path>        (MountInfo, :254)  — what `bao read sys/mounts/<path>` hit
 *     enable   POST   sys/mounts/<path>        (Mount, :57)       — `bao secrets enable`
 *     tune     POST   sys/mounts/<path>/tune   (TuneMount, :201)  — `bao secrets tune`
 *     disable  DELETE sys/mounts/<path>        (Unmount, :79)     — `bao secrets disable`
 */
import * as Effect from 'effect/Effect';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { BaoError } from './bao-status.ts';
import {
  type BaoMountProps,
  enableBody,
  mountPath,
  readPath,
  tuneBody,
  tunePath,
} from './mount-form.ts';

/**
 * Confirm a mount is absent from the mount table, or give back the error that asked.
 *
 * ⛔ A MISSING MOUNT IS NOT A 404, IT IS A 400 — AND THAT MADE A NEW MOUNT UNCREATABLE, SILENTLY,
 *   THE SAME WAY A NEW POLICY WAS (b3c18a33e). `handleReadMount` answers a path with no mount with a
 *   bare error response, "No secret engine mount at <path>" (vault/logical_system.go:1171-1178), and
 *   RespondErrorCommon turns an error response with no coded error into 400
 *   (sdk/logical/response_util.go). The CLI therefore exited 2 with that text, which was not
 *   `No value found at`, so every read of an undeclared-yet mount FAILED and reconcile never
 *   reached `secrets enable`. All four declared mounts already exist, which is the only reason
 *   nothing broke. REASONED FROM SOURCE, NOT MEASURED — no read of a missing mount was run.
 * ★ SO A 400 IS SETTLED BY A SECOND, STATUS-CLASSIFIED QUESTION rather than by matching that text:
 *   `GET sys/mounts` lists the namespace's mount table, keyed `<path>/`. Only a 200 table WITHOUT
 *   the key is absence. A listed mount, a refused listing, or a 404 listing leaves the original 400
 *   standing — "I could not tell" is an error, never a create.
 * ⚠️ THE LISTING NEEDS `read` ON `sys/mounts`. The admin lane has it
 *   (policies/homeflare-admin/live-captured-2026-09-02.hcl:20). A narrower token still fails, which
 *   is what it did before.
 */
const absentFromTable = (path: string, asked: BaoError) =>
  baoRead('sys/mounts').pipe(
    // ⚠️ A listing that fails keeps the 400, and says why it could not settle it.
    Effect.mapError(
      (listing) =>
        new BaoError(asked.status, asked.method, asked.path, [
          ...asked.errors,
          `sys/mounts could not confirm the mount is absent: ${listing.message}`,
        ]),
    ),
    Effect.flatMap((table) =>
      table !== undefined && !Object.hasOwn(table, `${mountPath(path)}/`)
        ? Effect.succeed(undefined)
        : Effect.fail(asked),
    ),
  );

/** One mount's config (`type`, `description`, `config.*_lease_ttl`), or undefined when absent. */
export const readMountData = (path: string) =>
  baoRead(readPath(path)).pipe(
    Effect.catchIf(
      (error) => error.status === 400,
      (error) => absentFromTable(path, error),
    ),
  );

export const enableMount = (props: BaoMountProps) =>
  baoWrite('POST', readPath(props.path), enableBody(props));

export const tuneMount = (props: BaoMountProps) =>
  baoWrite('POST', tunePath(props.path), tuneBody(props));

/**
 * ⚠️ THERE IS NO FORCE. The old delete ran `bao secrets disable -force`, and v2.6.2's
 *   command/secrets_disable.go defines no `-force` flag, so that argv would have been refused at
 *   flag parsing. `Unmount` is a plain DELETE (api/sys_mounts.go:79); nothing else was ever sent.
 */
export const disableMount = (path: string) => baoDelete(readPath(path));
