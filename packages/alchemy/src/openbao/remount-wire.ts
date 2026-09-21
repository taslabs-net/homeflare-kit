/**
 * `sys/remount` — move a secrets engine or auth method to a new path WITH its data — and the status
 * polling it needs, because the move finishes after the call returns.
 *
 * ★ READ FROM openbao v2.6.2, NOT RECALLED:
 *   · api/sys_mounts.go:95-191 — the CLI's `bao secrets move` POSTs `{from, to}` to sys/remount,
 *     takes `data.migration_id`, then GETs sys/remount/status/<id> once a second until
 *     `migration_info.status` is `success` or `failure`. This is that loop, bounded.
 *   · vault/logical_system.go:1257-1357 — the handler validates, records the migration and
 *     answers AT ONCE; a goroutine does the move. So a 200 means "queued", never "moved".
 *   · vault/mount.go:630-735 — the mount keeps its UUID, and storage lives under the UUID, so every
 *     secret stays. ⛔ BUT EVERY LEASE UNDER THE SOURCE IS REVOKED (`RevokePrefix`, :684): a move of
 *     a dynamic-secrets mount kills every credential it has issued. KV has no leases.
 *   · vault/logical_system.go:67-69 — `remount` is a sudo path. The status path is not.
 * ⚠️ THE STATUS TRACKER IS IN MEMORY (vault/mount.go:2303-2336, a sync.Map on the active node). A
 *   restart or leader change mid-move loses it, and the status read then answers 404. That is not a
 *   failure and not a success; `confirm` settles it from the mount tables, or the call fails.
 * ⛔ POLICIES ARE NOT REWRITTEN. Every ACL path naming the old mount keeps naming it.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoCall, baoRead } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';

/** A move OpenBao reported failed, or one this could not confirm. Never carries a token. */
export class RemountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemountError';
  }
}

export interface RemountOptions {
  /** Milliseconds between status reads. Default 1000 — the CLI's own pace. */
  readonly intervalMillis?: number;
  /** Status reads before giving up. Default 120, so about two minutes. */
  readonly attempts?: number;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** POST sys/remount and return the migration id. `from`/`to` are full paths (`auth/x` for auth). */
export const startRemount = (
  from: string,
  to: string,
): Effect.Effect<string, BaoError | RemountError, HttpClient.HttpClient> =>
  Effect.flatMap(baoCall('write', 'POST', 'sys/remount', { from, to }), (body) => {
    const id = record(body?.['data'])?.['migration_id'];
    return typeof id === 'string' && id !== ''
      ? Effect.succeed(id)
      : Effect.fail(new RemountError(`sys/remount ${from} -> ${to} answered no migration_id.`));
  });

/** `in-progress`, `success`, `failure` — or undefined when the server no longer knows the id. */
export const remountStatus = (
  id: string,
): Effect.Effect<string | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.map(baoRead(`sys/remount/status/${encodeURIComponent(id)}`), (data) => {
    if (data === undefined) return undefined;
    const status = record(data['migration_info'])?.['status'];
    return typeof status === 'string' ? status : 'unknown';
  });

/**
 * Move `from` to `to` and wait until OpenBao says it is done.
 *
 * @param confirm answers "does the mount table show the move finished?" — asked only when the
 *   status tracker has forgotten the id. True is success; false fails.
 */
export const remountAndWait = (
  from: string,
  to: string,
  confirm: Effect.Effect<boolean, BaoError, HttpClient.HttpClient>,
  options: RemountOptions = {},
): Effect.Effect<void, BaoError | RemountError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const interval = options.intervalMillis ?? 1000;
    const attempts = Math.max(1, options.attempts ?? 120);
    const id = yield* startRemount(from, to);
    const named = `sys/remount ${from} -> ${to} (migration ${id})`;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const status = yield* remountStatus(id);
      if (status === 'success') return;
      if (status === 'failure') {
        return yield* Effect.fail(
          new RemountError(
            `${named} FAILED. The server log carries the reason, tagged with that migration_id. ` +
              'Read sys/mounts (or sys/auth) before retrying: the source may be tainted.',
          ),
        );
      }
      if (status === undefined) {
        if (yield* confirm) return;
        return yield* Effect.fail(
          new RemountError(
            `${named}: the server no longer knows the migration (its tracker is in memory, lost ` +
              'on a restart or leader change), and the mount table does not show the move done.',
          ),
        );
      }
      if (attempt < attempts) yield* Effect.sleep(interval);
    }
    return yield* Effect.fail(
      new RemountError(
        `${named} is still in progress after ${String(attempts)} status reads. Do not re-run ` +
          `until sys/remount/status/${id} settles.`,
      ),
    );
  });
